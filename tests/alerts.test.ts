import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { ServiceStore } from "../src/service-store.js";
import type { ProbeOutcome } from "../src/probe.js";
import { AlertConflict } from "../src/alert-store.js";
const rule = { failureCount: 2, recoveryCount: 2, severity: "warning" as const, enabled: true };
function setup(path = ":memory:") {
  const store = new ServiceStore(path);
  const service = store.create(randomUUID(), "local", { name: "service", owner: "ops", targetId: "target", intervalSeconds: 30 }, "ops", "test");
  const start = Date.now() - 600_000;
  store.alerts.saveRule(service.id, rule, 0, "admin", "rule", start);
  const sample = (offset: number, outcome: ProbeOutcome, fingerprint = "fixed") => {
    const id = randomUUID(); const time = start + offset;
    assert.ok(store.claimProbe(service, id, fingerprint, "ops", "sample", time));
    store.finishProbe(id, { outcome, latencyMs: outcome === "success" ? 2 : null, httpStatus: outcome === "success" ? 200 : null }, time + 1);
    return id;
  };
  return { store, service, sample, start, events: () => store.alerts.list(service.id, 1).items };
}
test("alerts trigger once, acknowledge idempotently, recover and only then close", (t) => {
  const ctx = setup(); t.after(() => ctx.store.close());
  ctx.sample(30_000, "timeout"); assert.equal(ctx.events().length, 0);
  const id = ctx.sample(60_000, "http_error"); assert.equal(ctx.events().length, 1);
  ctx.store.finishProbe(id, { outcome: "success", httpStatus: 200, latencyMs: 1 });
  ctx.sample(90_000, "timeout"); assert.equal(ctx.events().length, 1);
  const event = ctx.events()[0]!;
  assert.equal(event.rule.failureCount, 2); assert.equal(event.rule.version, 1);
  assert.throws(() => ctx.store.alerts.transition(event.id, "close", "ops", "close"), AlertConflict);
  ctx.store.alerts.transition(event.id, "acknowledge", "ops", "ack");
  ctx.store.alerts.transition(event.id, "acknowledge", "other", "retry");
  assert.equal(ctx.events()[0]!.acknowledgedBy, "ops");
  ctx.sample(120_000, "success"); assert.equal(ctx.events()[0]!.state, "acknowledged");
  ctx.sample(150_000, "success"); assert.equal(ctx.events()[0]!.state, "recovered");
  ctx.store.alerts.transition(event.id, "close", "ops", "close");
  ctx.store.alerts.transition(event.id, "close", "ops", "retry");
  assert.equal(ctx.events()[0]!.state, "closed");
  ctx.sample(180_000, "timeout"); ctx.sample(210_000, "timeout"); assert.equal(ctx.events().length, 2);
});
test("gaps, interrupted and out-of-order samples cannot fabricate continuity or recovery", (t) => {
  const ctx = setup(); t.after(() => ctx.store.close());
  ctx.sample(30_000, "timeout"); ctx.sample(60_000, "interrupted"); ctx.sample(90_000, "timeout"); assert.equal(ctx.events().length, 0);
  ctx.sample(180_000, "timeout"); assert.equal(ctx.events().length, 0);
  ctx.sample(210_000, "timeout"); assert.equal(ctx.events()[0]!.state, "firing");
  ctx.sample(240_000, "success"); ctx.sample(330_000, "success"); assert.equal(ctx.events()[0]!.state, "firing");
  const old = ctx.store.latestProbe(ctx.service.id)!;
  ctx.store.alerts.sample(ctx.service, { ...old, startedAt: ctx.start + 200_000 }, ctx.start + 331_000);
  assert.equal(ctx.events()[0]!.state, "firing");
  ctx.sample(360_000, "success"); assert.equal(ctx.events()[0]!.state, "recovered");
});
test("configuration and target revocation terminate rather than recover active events", (t) => {
  const ctx = setup(); t.after(() => ctx.store.close());
  ctx.sample(30_000, "timeout"); ctx.sample(60_000, "timeout");
  ctx.store.alerts.reconcile(new Map(), ctx.start + 61_000);
  assert.equal(ctx.events()[0]!.state, "terminated"); assert.equal(ctx.events()[0]!.reason, "target_unavailable");
  ctx.sample(90_000, "timeout"); ctx.sample(120_000, "timeout");
  ctx.store.update(ctx.service.id, 1, { ...ctx.service, enabled: false }, "admin", "disable");
  assert.equal(ctx.events()[0]!.reason, "service_disabled");
  assert.throws(() => ctx.store.alerts.saveRule(ctx.service.id, rule, 0, "admin", "stale"), AlertConflict);
});
test("rule counters survive restart and failed alert audit rolls back sample completion", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "medicalcare-alert-"));
  const path = join(directory, "state.sqlite"); const ctx = setup(path);
  ctx.sample(30_000, "timeout"); ctx.store.close();
  const store = new ServiceStore(path); const inspect = new DatabaseSync(path);
  t.after(async () => {
    inspect.close(); store.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + "medicalcare-alert-"));
    await rm(directory, { recursive: true, force: true });
  });
  inspect.exec("CREATE TRIGGER reject_alert BEFORE INSERT ON audit_events WHEN NEW.action LIKE 'alert.fired:%' BEGIN SELECT RAISE(ABORT, 'test audit failure'); END;");
  const id = randomUUID(); const timestamp = ctx.start + 60_000;
  assert.ok(store.claimProbe(ctx.service, id, "fixed", "ops", "sample", timestamp));
  assert.throws(() => store.finishProbe(id, { outcome: "timeout", httpStatus: null, latencyMs: null }, timestamp + 1));
  assert.equal(store.getProbe(id)!.outcome, "running"); assert.equal(store.alerts.list(ctx.service.id, 1).total, 0);
  inspect.exec("DROP TRIGGER reject_alert");
  store.finishProbe(id, { outcome: "timeout", httpStatus: null, latencyMs: null }, timestamp + 1);
  assert.equal(store.alerts.list(ctx.service.id, 1).total, 1);
});

test("environment alerts filter, paginate, clamp and exclude other environments", (t) => {
  const ctx = setup(); t.after(() => ctx.store.close());
  for (let i = 1; i <= 22; i++) {
    const service = ctx.store.create(randomUUID(), i === 22 ? "prod" : "local", { name: `service-${i}`, owner: "ops", targetId: `target-${i}`, intervalSeconds: 30 }, "ops", "test");
    ctx.store.alerts.saveRule(service.id, { ...rule, failureCount: 1, severity: i === 1 ? "critical" : "warning" }, 0, "ops", "rule", ctx.start);
    const id = randomUUID(); ctx.store.claimProbe(service, id, "fixed", "ops", "test", ctx.start + 30_000);
    ctx.store.finishProbe(id, { outcome: "timeout", httpStatus: null, latencyMs: null }, ctx.start + 30_001);
  }
  const first = ctx.store.alerts.environment("local", "active", 1);
  assert.equal(first.total, 21); assert.equal(first.items.length, 20); assert.equal(first.criticalActive, 1);
  const last = ctx.store.alerts.environment("local", "active", 999);
  assert.equal(last.page, 2); assert.equal(last.items.length, 1);
  assert.equal(new Set([...first.items, ...last.items].map((event) => event.id)).size, 21);
  ctx.store.alerts.transition(last.items[0]!.id, "acknowledge", "ops", "ack");
  const filtered = ctx.store.alerts.environment("local", "firing", 2);
  assert.equal(filtered.page, 1); assert.equal(filtered.total, 20); assert.equal(filtered.active, 21);
  assert.equal(filtered.counts.acknowledged, 1);
  assert.equal(ctx.store.alerts.environment("local", "closed", 1).total, 0);
  assert.equal(ctx.store.alerts.environment("prod", "all", 1).total, 1);
});
