import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ServiceStore } from "../src/service-store.js";
import { probeTrend } from "../src/probe-trend.js";
import type { ProbeResult } from "../src/probe.js";

test("trend buckets preserve boundaries, missing intervals and separate latency denominators", (t) => {
  const store = new ServiceStore(":memory:"); t.after(() => store.close());
  const service = store.create(randomUUID(), "local", { name: "test", owner: "ops", targetId: "health", intervalSeconds: 30 }, "ops", "test");
  const now = 10_000_000; const start = now - 3_600_000;
  const sample = (time: number, outcome: ProbeResult["outcome"], latencyMs: number | null) => {
    const id = randomUUID(); assert.equal(store.claimProbe(service, id, "fixed", "ops", "test", time), true);
    store.finishProbe(id, { outcome, latencyMs, httpStatus: latencyMs === null ? null : 200 }, time + 1);
  };
  sample(start, "success", 999); // left boundary excluded
  sample(start + 30_000, "success", 10);
  sample(start + 60_000, "http_error", 30); // exact bucket end belongs to first bucket
  sample(start + 90_000, "timeout", null);
  sample(start + 120_000, "interrupted", null);
  sample(now, "success", 5); // right boundary included
  sample(now + 30_000, "success", 999); // future excluded
  const result = probeTrend(store, service, "fixed", 1, now);
  assert.equal(result.points.length, 60);
  assert.equal(result.points[0]!.averageLatencyMs, 20);
  assert.equal(result.points[0]!.availabilityPercent, 50);
  assert.equal(result.points[0]!.latencySamples, 2);
  assert.equal(result.points[1]!.averageLatencyMs, null);
  assert.equal(result.points[1]!.availabilityPercent, 0);
  assert.equal(result.points[1]!.interrupted, 1);
  assert.equal(result.points[2]!.availabilityPercent, null);
  assert.equal(result.points[59]!.averageLatencyMs, 5);
  assert.equal(result.lastSampleAt, now);
  assert.equal(probeTrend(store, service, undefined, 24, now).points.length, 96);
  assert.equal(probeTrend(store, service, "revoked", 6, now).points.length, 72);
  assert.equal(probeTrend(store, service, "revoked", 6, now).lastSampleAt, null);
  const changed = store.update(service.id, 1, { ...service, owner: "new" }, "ops", "edit");
  assert.ok(probeTrend(store, changed, "fixed", 1, now).points.every((point) => point.samples === 0));
});
