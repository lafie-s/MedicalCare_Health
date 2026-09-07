import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { parseAccessPolicy, type AccessPolicy } from "../src/access-policy.js";
import { IdentityUnavailable, type IdentityProvider } from "../src/identity.js";
import { SessionStore } from "../src/session-store.js";
import { loadConfig } from "../src/config.js";

function setup() {
  const store = new SessionStore(":memory:", randomBytes(32));
  let policy: AccessPolicy = { environments: [{ id: "local", name: "开发", type: "development" }, { id: "prod", name: "生产", type: "production" }], grants: [{ userId: "ops-1", role: "viewer", environmentIds: ["local"] }] };
  let state: "valid" | "expired" | "offline" = "valid";
  const identity: IdentityProvider = {
    async verify(token) {
      if (state === "offline") throw new IdentityUnavailable();
      if (state === "expired" || token !== "valid-token") return null;
      return { userId: "ops-1", displayName: "运维人员", role: "ADMIN" };
    },
    async ready() { return state !== "offline"; },
  };
  const app = buildApp({ identity, store, policy: async () => policy, origin: "http://127.0.0.1:4310", secureCookie: false });
  const login = () => app.inject({ method: "POST", url: "/api/v1/auth/session", headers: { origin: "http://127.0.0.1:4310", authorization: "Bearer valid-token" } });
  return { app, store, login, setState: (next: typeof state) => { state = next; }, setPolicy: (next: AccessPolicy) => { policy = next; }, getPolicy: () => policy, close: async () => { await app.close(); store.close(); } };
}

test("unauthenticated and ungranted staff cannot access platform", async (t) => {
  const ctx = setup(); t.after(ctx.close);
  assert.equal((await ctx.app.inject("/api/v1/me")).statusCode, 401);
  ctx.setPolicy({ ...ctx.getPolicy(), grants: [] });
  assert.equal((await ctx.login()).statusCode, 403);
});

test("identity exchange sets protected cookie, restricts environment and does not inherit upstream admin", async (t) => {
  const ctx = setup(); t.after(ctx.close);
  const response = await ctx.login();
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().user.role, "viewer");
  const cookie = response.cookies[0]!;
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "Strict");
  assert.equal(cookie.path, "/api/v1");
  assert.ok(!response.body.includes("valid-token"));
  const cookies = { [cookie.name]: cookie.value };
  const environments = await ctx.app.inject({ url: "/api/v1/environments", cookies });
  assert.deepEqual(environments.json().items.map((item: { id: string }) => item.id), ["local"]);
  assert.equal((await ctx.app.inject({ url: "/api/v1/environments/prod", cookies })).statusCode, 403);
  assert.equal((await ctx.app.inject({ url: "/api/v1/environments/local", cookies })).statusCode, 200);
});

test("logout revokes session even while upstream is unavailable", async (t) => {
  const ctx = setup(); t.after(ctx.close);
  const cookie = (await ctx.login()).cookies[0]!;
  const cookies = { [cookie.name]: cookie.value };
  ctx.setState("offline");
  assert.equal((await ctx.app.inject({ url: "/api/v1/me", cookies })).statusCode, 503);
  assert.equal((await ctx.app.inject({ method: "POST", url: "/api/v1/auth/logout", cookies, headers: { origin: "http://127.0.0.1:4310" } })).statusCode, 204);
  ctx.setState("valid");
  assert.equal((await ctx.app.inject({ url: "/api/v1/me", cookies })).statusCode, 401);
});

test("grant removal immediately revokes existing session", async (t) => {
  const ctx = setup(); t.after(ctx.close);
  const cookie = (await ctx.login()).cookies[0]!;
  const cookies = { [cookie.name]: cookie.value };
  ctx.setPolicy({ ...ctx.getPolicy(), grants: [] });
  assert.equal((await ctx.app.inject({ url: "/api/v1/me", cookies })).statusCode, 403);
  assert.equal(ctx.store.find(cookie.value), null);
});

test("upstream token expiration invalidates local session", async (t) => {
  const ctx = setup(); t.after(ctx.close);
  const cookie = (await ctx.login()).cookies[0]!;
  ctx.setState("expired");
  assert.equal((await ctx.app.inject({ url: "/api/v1/me", cookies: { [cookie.name]: cookie.value } })).statusCode, 401);
  assert.equal(ctx.store.find(cookie.value), null);
});

test("cross-origin writes are rejected and repeated identity exchanges are rate limited", async (t) => {
  const ctx = setup(); t.after(ctx.close);
  assert.equal((await ctx.app.inject({ method: "POST", url: "/api/v1/auth/logout" })).statusCode, 403);
  assert.equal((await ctx.app.inject({ method: "POST", url: "/api/v1/auth/session", headers: { origin: "https://other.example", authorization: "Bearer valid-token" } })).statusCode, 403);
  let status = 0;
  for (let index = 0; index < 12; index++) status = (await ctx.login()).statusCode;
  assert.equal(status, 429);
});

test("readiness tracks provider outage", async (t) => {
  const ctx = setup(); t.after(ctx.close);
  assert.equal((await ctx.app.inject("/health/ready")).statusCode, 200);
  ctx.setState("offline");
  assert.equal((await ctx.app.inject("/health/ready")).statusCode, 503);
});

test("sessions survive restart encrypted, expire, and cannot replay after persistent revocation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mc-health-"));
  const path = join(dir, "state.sqlite");
  const key = randomBytes(32);
  let store = new SessionStore(path, key);
  try {
    const session = store.create("ops-1", "sensitive-upstream-token", "test");
    store.close(); store = new SessionStore(path, key);
    assert.equal(store.find(session.id)?.token, "sensitive-upstream-token");
    assert.ok(!(await readFile(path)).includes(Buffer.from("sensitive-upstream-token")));
    assert.ok(!(await readFile(path)).includes(Buffer.from(session.id)));
    store.revoke(session.id, "logout");
    store.close(); store = new SessionStore(path, key);
    assert.equal(store.find(session.id), null);
    const expired = store.create("ops-1", "token", "test", 1000);
    assert.equal(store.find(expired.id, expired.expiresAt), null);
    const first = store.create("ops-1", "token", "test");
    store.create("ops-1", "next", "test");
    assert.equal(store.find(first.id), null);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test("access policy rejects unknown environments and duplicate grants", () => {
  assert.throws(() => parseAccessPolicy({ environments: [], grants: [{ userId: "x", role: "admin", environmentIds: ["missing"] }] }));
  assert.throws(() => parseAccessPolicy({ environments: [{ id: "local", name: "开发", type: "development" }], grants: [{ userId: "x", role: "admin", environmentIds: ["local"] }, { userId: "x", role: "viewer", environmentIds: ["local"] }] }));
});

test("production fails closed and prevents unsafe identity configuration", () => {
  const env = { NODE_ENV: "production", MEDICALCARE_AUTH_URL: "https://identity.example", PLATFORM_ORIGIN: "https://health.example", ACCESS_POLICY_PATH: "policy.json", SESSION_KEY: randomBytes(32).toString("base64") };
  assert.ok(loadConfig(env).auth);
  assert.throws(() => loadConfig({ NODE_ENV: "production" }));
  assert.throws(() => loadConfig({ MEDICALCARE_AUTH_URL: "https://identity.example" }));
  assert.throws(() => loadConfig({ ...env, MEDICALCARE_AUTH_URL: "http://identity.example" }));
  assert.throws(() => loadConfig({ ...env, MEDICALCARE_AUTH_URL: "https://user:pass@identity.example" }));
  assert.throws(() => loadConfig({ ...env, SESSION_KEY: "invalid" }));
});
