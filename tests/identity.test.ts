import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createIdentityProvider, IdentityUnavailable } from "../src/identity.js";

test("identity adapter follows the existing auth/me contract over HTTP", async (t) => {
  const server = createServer((req, res) => {
    if (req.url === "/health/ready") { res.end("ok"); return; }
    assert.equal(req.url, "/auth/me");
    if (req.headers.authorization !== "Bearer valid") { res.writeHead(401); res.end(); return; }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ userId: "operator", displayName: "运维", role: "ADMIN", email: "unused@example.com", capabilities: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise<void>((resolve) => server.close(() => resolve())); });
  const provider = createIdentityProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  assert.deepEqual(await provider.verify("valid"), { userId: "operator", displayName: "运维", role: "ADMIN" });
  assert.equal(await provider.verify("invalid"), null);
  assert.equal(await provider.ready(), true);
});

for (const behavior of ["malformed", "redirect", "timeout", "unavailable"] as const) {
  test(`identity adapter fails closed for ${behavior}`, async (t) => {
    const server = createServer((_req, res) => {
      if (behavior === "timeout") return;
      if (behavior === "redirect") res.writeHead(302, { location: "http://127.0.0.1:1" });
      if (behavior === "unavailable") res.writeHead(503);
      res.end('{"userId":"incomplete"}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => { server.closeAllConnections(); return new Promise<void>((resolve) => server.close(() => resolve())); });
    const provider = createIdentityProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 100);
    await assert.rejects(provider.verify("token"), IdentityUnavailable);
  });
}
