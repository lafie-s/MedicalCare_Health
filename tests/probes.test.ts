import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { ProbeRunner, probeTarget, serviceHealth, targetFingerprint, ProbeRejected } from "../src/probe.js";
import { ServiceStore } from "../src/service-store.js";
import type { AccessPolicy, ProbeTarget } from "../src/access-policy.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

test("HTTP probe pins DNS, preserves Host and never follows redirects or reads bodies", async (t) => {
  let redirected = 0;
  const server = createServer((req, res) => {
    assert.ok(req.headers.host?.startsWith("nonexistent.invalid:"));
    assert.equal(req.headers.authorization, undefined);
    if (req.url === "/redirect") { res.writeHead(302, { Location: "/forbidden" }); res.end(); return; }
    if (req.url === "/forbidden") redirected++;
    if (req.url === "/timeout") return;
    res.writeHead(req.url === "/error" ? 503 : 200); res.flushHeaders();
    // Deliberately never end the body: receiving headers must finish the probe.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise<void>((resolve) => server.close(() => resolve())); });
  const target: ProbeTarget = { id: "ready", environmentId: "local", name: "就绪", url: `http://nonexistent.invalid:${(server.address() as AddressInfo).port}/ready`, address: "127.0.0.1" };
  const success = await probeTarget(target);
  assert.equal(success.outcome, "success"); assert.equal(success.httpStatus, 200); assert.ok(success.latencyMs !== null && success.latencyMs >= 0);
  const request = (path: string) => probeTarget({ ...target, url: target.url.replace("/ready", path) }, 100);
  assert.equal((await request("/error")).outcome, "http_error");
  assert.equal((await request("/redirect")).httpStatus, 302); assert.equal(redirected, 0);
  assert.equal((await request("/timeout")).outcome, "timeout");
});

function setup() {
  const store = new ServiceStore(":memory:");
  const service = store.create(randomUUID(), "local", { name: "聊天服务", owner: "运维", targetId: "ready", intervalSeconds: 30 }, "admin", "test");
  const target: ProbeTarget = { id: "ready", environmentId: "local", name: "就绪", url: "http://127.0.0.1:4400/ready", address: "127.0.0.1" };
  const policy: AccessPolicy = { environments: [{ id: "local", name: "开发", type: "development" }], grants: [], probeTargets: [target] };
  return { store, service, target, policy };
}
test("health status distinguishes missing, success, error, stale and changed configuration", (t) => {
  const { store, service, target } = setup(); t.after(() => store.close());
  const now = 1_000_000;
  assert.equal(serviceHealth(service, target, store, now).status, "unknown");
  const fingerprint = targetFingerprint(target);
  const first = randomUUID(); store.claimProbe(service, first, fingerprint, "admin", "test", now - 60_000);
  store.finishProbe(first, { outcome: "http_error", httpStatus: 503, latencyMs: 10 }, now - 59_000);
  assert.equal(serviceHealth(service, target, store, now - 58_000).status, "unhealthy");
  const next = randomUUID(); store.claimProbe(service, next, fingerprint, "admin", "test", now - 30_000);
  store.finishProbe(next, { outcome: "success", httpStatus: 200, latencyMs: 4 }, now - 29_000);
  const health = serviceHealth(service, target, store, now);
  assert.equal(health.status, "healthy"); assert.equal(health.availabilityPercent, 50); assert.equal(health.samplesInWindow, 2);
  assert.equal(serviceHealth(service, target, store, now + 40_000).status, "unknown");
  assert.equal(serviceHealth(service, undefined, store, now).reason, "target_revoked");
  assert.equal(serviceHealth(service, { ...target, url: "http://127.0.0.1:4401/ready" }, store, now).reason, "no_current_sample");
  const edited = store.update(service.id, 1, { ...service, enabled: false }, "admin", "test");
  assert.equal(serviceHealth(edited, target, store, now).status, "disabled");
  assert.equal(serviceHealth({ ...edited, enabled: true }, target, store, now).availabilityPercent, null);
});
test("probe window is (start, end], interrupted runs never count as failed samples", (t) => {
  const { store, service, target } = setup(); t.after(() => store.close());
  const now = 1_000_000; const fingerprint = targetFingerprint(target);
  for (const [start, outcome] of [[now - 300_000, "success"], [now - 200_000, "interrupted"], [now - 100_000, "timeout"]] as const) {
    const id = randomUUID(); assert.equal(store.claimProbe(service, id, fingerprint, "admin", "test", start), true);
    store.finishProbe(id, { outcome, httpStatus: null, latencyMs: null }, start + 10);
  }
  const stats = store.probeStats(service, fingerprint, now);
  assert.deepEqual(stats, { samples: 1, successful: 0 });
});
test("runner is idempotent and refuses disabled or revoked targets without network requests", async (t) => {
  const { store, service, target, policy } = setup(); t.after(() => store.close());
  let calls = 0;
  const runner = new ProbeRunner(store, async () => policy, async () => { calls++; return { outcome: "success", httpStatus: 200, latencyMs: 1 }; });
  const id = randomUUID();
  const first = await runner.run(service.id, id, "admin", "test");
  assert.deepEqual(await runner.run(service.id, id, "admin", "test"), first); assert.equal(calls, 1);
  await assert.rejects(runner.run(service.id, randomUUID(), "admin", "test"), (error: unknown) => error instanceof ProbeRejected && error.code === "BUSY");
  policy.probeTargets = [];
  await assert.rejects(runner.run(service.id, randomUUID(), "admin", "test"), (error: unknown) => error instanceof ProbeRejected && error.code === "TARGET_REVOKED");
  policy.probeTargets = [target]; store.update(service.id, 1, { ...service, enabled: false }, "admin", "test");
  await assert.rejects(runner.run(service.id, randomUUID(), "admin", "test"), (error: unknown) => error instanceof ProbeRejected && error.code === "DISABLED");
  assert.equal(calls, 1);
});
test("scheduler samples due services once and skips disabled services", async (t) => {
  const { store, service, policy } = setup(); t.after(() => store.close());
  let calls = 0;
  const runner = new ProbeRunner(store, async () => policy, async () => { calls++; return { outcome: "success", httpStatus: 200, latencyMs: 1 }; });
  await runner.tick(); await runner.tick(); assert.equal(calls, 1);
  store.update(service.id, 1, { ...service, enabled: false }, "admin", "test");
  await runner.tick(); assert.equal(calls, 1); await runner.stop();
});
test("expired run leases become interrupted and late completion cannot replace them", (t) => {
  const { store, service, target } = setup(); t.after(() => store.close());
  const old = randomUUID(), current = randomUUID(), now = 1_000_000;
  store.claimProbe(service, old, targetFingerprint(target), "admin", "test", now - 60_000);
  assert.equal(store.claimProbe(service, current, targetFingerprint(target), "admin", "test", now), true);
  assert.equal(store.getProbe(old)?.outcome, "interrupted");
  store.finishProbe(old, { outcome: "success", httpStatus: 200, latencyMs: 1 }, now + 10);
  assert.equal(store.getProbe(old)?.outcome, "interrupted");
});

test("concurrent probes are capped at four and an in-flight duplicate performs no extra request", async (t) => {
  const { store, policy, target } = setup(); t.after(() => store.close());
  const services = [];
  for (let index = 0; index < 5; index++) {
    const extra = { ...target, id: `target-${index}` }; policy.probeTargets!.push(extra);
    services.push(store.create(randomUUID(), "local", { name: "服务", owner: "运维", targetId: extra.id, intervalSeconds: 30 }, "admin", "test"));
  }
  let release!: () => void; const barrier = new Promise<void>((resolve) => { release = resolve; });
  let count = 0;
  const runner = new ProbeRunner(store, async () => policy, async () => { count++; await barrier; return { outcome: "success", httpStatus: 200, latencyMs: 1 }; });
  const ids = services.map(() => randomUUID());
  const pending = services.slice(0, 4).map((service, index) => runner.run(service.id, ids[index]!, "admin", "test"));
  await Promise.resolve(); await Promise.resolve();
  try {
    assert.equal((await runner.run(services[0]!.id, ids[0]!, "admin", "test")).outcome, "running");
    await assert.rejects(runner.run(services[4]!.id, ids[4]!, "admin", "test"), (error: unknown) => error instanceof ProbeRejected && error.code === "BUSY");
    assert.equal(count, 4);
  } finally { release(); await Promise.all(pending); }
});

test("samples and idempotency survive SQLite reopen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mc-probes-"));
  const path = join(dir, "state.sqlite"); let store = new ServiceStore(path);
  try {
    const service = store.create(randomUUID(), "local", { name: "服务", owner: "运维", targetId: "ready", intervalSeconds: 30 }, "admin", "test");
    const target: ProbeTarget = { id: "ready", name: "目标", environmentId: "local", url: "http://127.0.0.1/ready", address: "127.0.0.1" };
    const policy = async (): Promise<AccessPolicy> => ({ environments: [], grants: [], probeTargets: [target] });
    const id = randomUUID();
    await new ProbeRunner(store, policy, async () => ({ outcome: "success", httpStatus: 200, latencyMs: 3 })).run(service.id, id, "admin", "test");
    store.close(); store = new ServiceStore(path);
    let repeated = false;
    const replay = await new ProbeRunner(store, policy, async () => { repeated = true; throw new Error(); }).run(service.id, id, "admin", "test");
    assert.equal(replay.outcome, "success"); assert.equal(repeated, false); assert.equal(serviceHealth(service, target, store).status, "healthy");
    store.pruneProbes(Date.now() + 86_400_001); assert.equal(store.latestProbe(service.id), null);
  } finally {
    store.close();
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep) || !dir.includes("mc-probes-")) throw new Error("Invalid test cleanup path");
    await rm(dir, { recursive: true, force: true });
  }
});
