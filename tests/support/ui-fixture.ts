// Isolated manual browser fixture. Never used by src/server.ts or production builds.
import { randomBytes, randomUUID } from "node:crypto";
import { buildApp } from "../../src/app.js";
import { SessionStore } from "../../src/session-store.js";
import { ServiceStore } from "../../src/service-store.js";
import { ProbeRunner, targetFingerprint } from "../../src/probe.js";
import type { AccessPolicy } from "../../src/access-policy.js";
if (process.env.NODE_ENV !== "test") throw new Error("UI fixture requires NODE_ENV=test");
const store = new SessionStore(":memory:", randomBytes(32));
const services = new ServiceStore(":memory:");
const policy = async (): Promise<AccessPolicy> => ({ environments: [{ id: "local", name: "本地开发", type: "development" }, { id: "staging", name: "集成验证环境", type: "staging" }], grants: [{ userId: "fixture-operator", role: "admin", environmentIds: ["local", "staging"] }], probeTargets: [{ id: "local-health", environmentId: "local", name: "本地就绪接口（测试）", url: "http://127.0.0.1:4310/health/live", address: "127.0.0.1" }] });
const runner = new ProbeRunner(services, policy);
const app = buildApp({
  identity: {
    async login(email, password) {
      if (email === "offline@example.test") throw new Error("Fixture offline");
      if (password !== "fixture-password") return null;
      return email === "denied@example.test" ? "denied-token" : "fixture-token";
    },
    async verify(token) { return { userId: token === "denied-token" ? "denied" : "fixture-operator", displayName: "测试运维人员", role: "ADMIN" }; },
    async ready() { return true; },
  },
  store, services, probeRunner: runner, origin: "http://127.0.0.1:4320", secureCookie: false, policy,
});
// Optional deterministic event fixture; normal UI fixture still exercises live scheduling.
if (process.env.UI_ALERT_FIXTURE === "1") {
  const service = services.create(randomUUID(), "local", { name: "告警验证服务", owner: "测试运维", targetId: "local-health", intervalSeconds: 30 }, "fixture", "fixture");
  const start = Date.now() - 240_000;
  services.alerts.saveRule(service.id, { enabled: true, failureCount: 2, recoveryCount: 2, severity: "warning" }, 0, "fixture", "fixture", start);
  const target = (await policy()).probeTargets![0]!;
  for (let i = 1; i <= 6; i++) {
    const id = randomUUID(); const time = start + i * 30_000;
    services.claimProbe(service, id, targetFingerprint(target), "fixture", "fixture", time);
    services.finishProbe(id, { outcome: i === 3 || i === 4 ? "success" : "timeout", httpStatus: null, latencyMs: null }, time + 1);
  }
} else app.addHook("onReady", async () => runner.start(() => {}));
app.addHook("preClose", async () => runner.stop());
app.addHook("onClose", async () => { services.close(); store.close(); });
await app.listen({ host: "127.0.0.1", port: 4310 });
