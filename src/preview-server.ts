// Separate public demonstration entrypoint. Never imported by the production server.
import { randomBytes, randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { SessionStore } from "./session-store.js";
import { ServiceStore } from "./service-store.js";
import { targetFingerprint } from "./probe.js";
import type { AccessPolicy } from "./access-policy.js";
if (process.env.HEALTH_PREVIEW !== "1") throw new Error("Explicit HEALTH_PREVIEW=1 required");
const origin = process.env.PREVIEW_ORIGIN;
if (!origin || new URL(origin).origin !== origin) throw new Error("Preview origin required");
const sessions = new SessionStore(":memory:", randomBytes(32));
const services = new ServiceStore(":memory:");
const target = { id: "demo-target", name: "示例探测目标（不执行）", environmentId: "demo", url: "http://127.0.0.1:4310/health/live", address: "127.0.0.1" };
const policy: AccessPolicy = { environments: [{ id: "demo", name: "MedicalCareWeb 演示环境", type: "development" }], grants: [{ userId: "demo", role: "admin", environmentIds: ["demo"] }], probeTargets: [target] };
const service = services.create(randomUUID(), "demo", { name: "聊天服务 · 示例", owner: "演示运维", targetId: target.id, intervalSeconds: 30 }, "demo", "demo");
const start = Date.now() - 180_000;
services.alerts.saveRule(service.id, { enabled: true, failureCount: 2, recoveryCount: 2, severity: "warning" }, 0, "demo", "demo", start);
for (let i = 1; i <= 4; i++) { const id = randomUUID(); const at = start + i * 30_000; services.claimProbe(service, id, targetFingerprint(target), "demo", "demo", at); services.finishProbe(id, { outcome: "timeout", httpStatus: null, latencyMs: null }, at + 1); }
const app = buildApp({ store: sessions, services, policy: async () => policy, origin, secureCookie: origin.startsWith("https:"), identity: {
  async ready() { return true; },
  async login(email, password) { return email === "demo@example.test" && password === "preview-only" ? "demo-token" : null; },
  async verify(token) { return token === "demo-token" ? { userId: "demo", displayName: "演示管理员", role: "ADMIN" } : null; },
} });
app.addHook("onClose", async () => { services.close(); sessions.close(); });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void app.close(); });
await app.listen({ host: "0.0.0.0", port: 4310 });
