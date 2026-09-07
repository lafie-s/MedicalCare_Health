import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

test("configuration defaults to loopback and rejects invalid ports", () => {
  assert.equal(loadConfig({}).host, "127.0.0.1");
  for (const port of ["0", "65536", "1.5", "not-a-port"]) assert.throws(() => loadConfig({ PORT: port }));
});

test("liveness does not falsely claim an unconfigured platform is ready", async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  const live = await app.inject("/health/live");
  assert.equal(live.statusCode, 200);
  assert.equal(live.headers["cache-control"], "no-store");
  assert.equal((await app.inject("/health/ready")).statusCode, 503);
  const missing = await app.inject("/api/v1/me");
  assert.equal(missing.statusCode, 404);
  assert.ok(missing.json().requestId);
});
