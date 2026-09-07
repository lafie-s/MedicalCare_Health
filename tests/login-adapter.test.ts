import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createIdentityProvider, IdentityUnavailable } from "../src/identity.js";

for (const mode of ["success", "invalid", "cleanup-failed", "malformed"] as const) {
  test(`credential adapter ${mode} and upstream refresh cleanup`, async (t) => {
    let revoked = false;
    const server = createServer(async (req, res) => {
      if (req.url === "/auth/logout") {
        assert.equal(req.headers.cookie, "hc_chat_refresh=temporary-token");
        revoked = true; res.writeHead(mode === "cleanup-failed" ? 503 : 204); res.end(); return;
      }
      assert.equal(req.url, "/auth/login");
      let body = ""; for await (const chunk of req) body += chunk;
      assert.deepEqual(JSON.parse(body), { email: "ops@example.test", password: "password" });
      if (mode === "invalid") { res.writeHead(401); res.end(); return; }
      res.setHeader("Set-Cookie", "hc_chat_refresh=temporary-token; HttpOnly; Path=/");
      res.end(mode === "malformed" ? "invalid-json" : JSON.stringify({ accessToken: "access-token" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => { server.closeAllConnections(); return new Promise<void>((resolve) => server.close(() => resolve())); });
    const provider = createIdentityProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    if (mode === "success") assert.equal(await provider.login!("ops@example.test", "password"), "access-token");
    else if (mode === "invalid") assert.equal(await provider.login!("ops@example.test", "password"), null);
    else await assert.rejects(provider.login!("ops@example.test", "password"), IdentityUnavailable);
    assert.equal(revoked, mode !== "invalid");
  });
}
