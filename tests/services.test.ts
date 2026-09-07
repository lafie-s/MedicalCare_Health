import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { parseAccessPolicy, type AccessPolicy, type Grant } from "../src/access-policy.js";
import { SessionStore } from "../src/session-store.js";
import { ServiceStore } from "../src/service-store.js";
import { ProbeRunner } from "../src/probe.js";

function setup() {
  const sessions = new SessionStore(":memory:", randomBytes(32));
  const services = new ServiceStore(":memory:");
  let role: Grant["role"] = "admin";
  const policy: AccessPolicy = { environments: [{ id: "local", name: "本地", type: "development" }, { id: "prod", name: "生产", type: "production" }], grants: [], probeTargets: [{ id: "health", environmentId: "local", name: "就绪接口", url: "http://127.0.0.1:9999/health/ready", address: "127.0.0.1" }] };
  const runner = new ProbeRunner(services, async () => policy, async () => ({ outcome: "success", httpStatus: 200, latencyMs: 2 }));
  const app = buildApp({ store: sessions, services, probeRunner: runner, identity: { verify: async () => ({ userId: "ops", displayName: "运维", role: "ADMIN" }), ready: async () => true }, policy: async () => ({ ...policy, grants: [{ userId: "ops", role, environmentIds: ["local"] }] }), origin: "http://127.0.0.1:4320", secureCookie: false });
  const session = sessions.create("ops", "token", "test");
  const headers = { origin: "http://127.0.0.1:4320", cookie: `mc_health_session=${session.id}` };
  const payload = { idempotencyKey: randomUUID(), environmentId: "local", name: "聊天服务", owner: "运维组", targetId: "health", intervalSeconds: 30 };
  return { app, services, headers, payload, policy, setRole: (value: Grant["role"]) => { role = value; }, close: async () => { await app.close(); services.close(); sessions.close(); } };
}

test("health overview is environment-authorized and shares a consistent service snapshot", async (t) => {
  const ctx = setup(); t.after(ctx.close);
  const url = "/api/v1/health/overview?environmentId=local";
  assert.equal((await ctx.app.inject(url)).statusCode, 401);
  assert.equal((await ctx.app.inject({ url: "/api/v1/health/overview?environmentId=prod", headers: ctx.headers })).statusCode, 403);
  await ctx.app.inject({ method: "POST", url: "/api/v1/services", headers: ctx.headers, payload: ctx.payload });
  ctx.setRole("viewer");
  const response = await ctx.app.inject({ url, headers: ctx.headers });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().overview.counts.unknown, 1);
  assert.equal(response.json().asOf, response.json().items[0].health.asOf);
  assert.equal(response.json().overview.asOf, response.json().asOf);
  assert.ok(!response.body.includes("127.0.0.1:9999"));
});

test("trend query enforces authorization and bounded ranges for read-only users", async (t) => {
  const ctx = setup(); t.after(ctx.close);
  await ctx.app.inject({ method: "POST", url: "/api/v1/services", headers: ctx.headers, payload: ctx.payload });
  const url = `/api/v1/services/${ctx.payload.idempotencyKey}/trend`;
  assert.equal((await ctx.app.inject(url)).statusCode, 401);
  const other = ctx.services.create(randomUUID(), "prod", { name: "secret", owner: "ops", targetId: "prod", intervalSeconds: 30 }, "ops", "test");
  assert.equal((await ctx.app.inject({ url: `/api/v1/services/${other.id}/trend`, headers: ctx.headers })).statusCode, 404);
  ctx.setRole("viewer");
  for (const hours of ["0", "48", "1.5", "NaN"]) assert.equal((await ctx.app.inject({ url: `${url}?hours=${hours}`, headers: ctx.headers })).statusCode, 400);
  assert.equal((await ctx.app.inject({ url: `${url}?hours=1&start=0`, headers: ctx.headers })).statusCode, 400);
  const result = await ctx.app.inject({ url: `${url}?hours=24`, headers: ctx.headers });
  assert.equal(result.statusCode, 200); assert.equal(result.json().points.length, 96);
  assert.ok(result.json().points.every((point: { averageLatencyMs: null }) => point.averageLatencyMs === null));
  assert.ok(!result.body.includes("127.0.0.1"));
  ctx.policy.probeTargets = [];
  assert.equal((await ctx.app.inject({ url, headers: ctx.headers })).json().targetAvailable, false);
});
test("service directory enforces environment scope and admin-only writes", async (t) => {
  const ctx = setup(); t.after(ctx.close);
  assert.equal((await ctx.app.inject("/api/v1/services?environmentId=local")).statusCode, 401);
  assert.equal((await ctx.app.inject({ url: "/api/v1/services?environmentId=prod", headers: ctx.headers })).statusCode, 403);
  ctx.setRole("operator");
  assert.equal((await ctx.app.inject({ method: "POST", url: "/api/v1/services", headers: ctx.headers, payload: ctx.payload })).statusCode, 403);
  const list = await ctx.app.inject({ url: "/api/v1/services?environmentId=local", headers: ctx.headers });
  assert.deepEqual(list.json().items, []);
  assert.deepEqual(list.json().targets, [{ id: "health", name: "就绪接口" }]);
  assert.ok(!list.body.includes("127.0.0.1:9999"));
});
test("service create is idempotent, validates allowlist and rejects duplicates", async (t) => {
  const ctx = setup(); t.after(ctx.close);
  const create = (payload = ctx.payload) => ctx.app.inject({ method: "POST", url: "/api/v1/services", headers: ctx.headers, payload });
  assert.equal((await create({ ...ctx.payload, targetId: "arbitrary-url" })).statusCode, 400);
  assert.equal((await create({ ...ctx.payload, intervalSeconds: 1 })).statusCode, 400);
  assert.equal((await create()).statusCode, 201);
  assert.equal((await create()).statusCode, 201);
  assert.equal(ctx.services.list("local").length, 1);
  assert.equal((await create({ ...ctx.payload, idempotencyKey: randomUUID() })).statusCode, 409);
});
test("service edits require current version; revoked targets can still be disabled", async (t) => {
  const ctx = setup(); t.after(ctx.close);
  await ctx.app.inject({ method: "POST", url: "/api/v1/services", headers: ctx.headers, payload: ctx.payload });
  const url = `/api/v1/services/${ctx.payload.idempotencyKey}`;
  const patch = (payload: object) => ctx.app.inject({ method: "PATCH", url, headers: ctx.headers, payload });
  assert.equal((await patch({ version: 1, owner: "新负责人" })).statusCode, 200);
  assert.equal((await patch({ version: 1, enabled: false })).statusCode, 409);
  ctx.policy.probeTargets = [];
  assert.equal((await patch({ version: 2, enabled: false })).statusCode, 200);
  assert.equal((await patch({ version: 3, enabled: true })).statusCode, 400);
  ctx.setRole("viewer");
  assert.equal((await patch({ version: 3, name: "越权修改" })).statusCode, 403);
});
test("probe policy rejects credentials, unbound IPs and cross-environment targets", () => {
  const policy = { environments: [{ id: "local", name: "开发", type: "development" }], grants: [], probeTargets: [{ id: "health", environmentId: "local", name: "目标", url: "https://health.example/health", address: "127.0.0.1" }] };
  assert.ok(parseAccessPolicy(policy));
  for (const change of [{ url: "file:///etc/passwd" }, { url: "https://user:secret@health.example/" }, { url: "http://127.0.0.2/" }, { address: "health.example" }, { environmentId: "prod" }, { url: "https://health.example/?token=secret" }]) {
    assert.throws(() => parseAccessPolicy({ ...policy, probeTargets: [{ ...policy.probeTargets[0], ...change }] }));
  }
});

test("manual probe endpoint enforces role, idempotency and sampling cooldown", async (t) => {
  const ctx = setup(); t.after(ctx.close);
  await ctx.app.inject({ method: "POST", url: "/api/v1/services", headers: ctx.headers, payload: ctx.payload });
  const url = `/api/v1/services/${ctx.payload.idempotencyKey}/probe`;
  const key = randomUUID(); const request = () => ctx.app.inject({ method: "POST", url, headers: { ...ctx.headers, "idempotency-key": key } });
  ctx.setRole("viewer"); assert.equal((await request()).statusCode, 403);
  ctx.setRole("operator");
  assert.equal((await ctx.app.inject({ method: "POST", url, headers: ctx.headers })).statusCode, 400);
  const result = await request(); assert.equal(result.statusCode, 200); assert.equal(result.json().outcome, "success");
  assert.equal((await request()).json().id, result.json().id);
  assert.equal((await ctx.app.inject({ method: "POST", url, headers: { ...ctx.headers, "idempotency-key": randomUUID() } })).statusCode, 409);
  assert.equal((await ctx.app.inject({ method: "POST", url: `/api/v1/services/${randomUUID()}/probe`, headers: { ...ctx.headers, "idempotency-key": randomUUID() } })).statusCode, 404);
  const list = await ctx.app.inject({ url: "/api/v1/services?environmentId=local", headers: ctx.headers });
  assert.equal(list.json().items[0].health.status, "healthy");
  assert.equal(list.json().items[0].health.samplesInWindow, 1);
});
