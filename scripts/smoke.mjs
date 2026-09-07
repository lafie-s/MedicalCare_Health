import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const env = { ...process.env, HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "test" };
for (const name of ["MEDICALCARE_AUTH_URL", "PLATFORM_ORIGIN", "ACCESS_POLICY_PATH", "SESSION_KEY", "STATE_DB_PATH"]) delete env[name];
const child = spawn(process.execPath, ["dist/server.js"], { env, windowsHide: true, stdio: "ignore" });
const exited = once(child, "exit");
try {
  let response;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) throw new Error("Built server exited before becoming live");
    try { response = await fetch(`http://127.0.0.1:${port}/health/live`, { signal: AbortSignal.timeout(500) }); break; }
    catch { await delay(100); }
  }
  assert.equal(response?.status, 200, "Built server must become live");
  assert.equal((await response.json()).service, "medicalcare-health");
  const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
  assert.equal(ready.status, 503, "Unconfigured server must remain unavailable");
  await ready.body?.cancel();
  console.log("Built server smoke check passed: live=200, unconfigured ready=503");
} finally {
  child.kill();
  await exited;
}
