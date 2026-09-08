import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { ServiceStore } from "./service-store.js";
import type { Authorization } from "./service-routes.js";
import { accessChangeSchema, matchesAllowlist } from "./maintenance-access.js";
import { AccessConflict } from "./maintenance-access-store.js";
export interface MaintenanceGate { serviceId: string; token: string; mode: "demo" | "nginx" }
export function accessSnapshot(store: ServiceStore, serviceId: string) {
  const policy = store.maintenanceAccess.get(serviceId); const now = Date.now();
  return { ...policy, active: policy.mode === "manual" || policy.mode === "window" && store.maintenance.active(serviceId, now) > 0, asOf: now };
}
export async function registerAccessRoutes(app: FastifyInstance, store: ServiceStore, authorize: Authorization, gate?: MaintenanceGate) {
  const url = "/api/v1/services/:id/maintenance-access";
  app.get<{ Params: { id: string } }>(url, async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    const service = store.get(request.params.id);
    if (!service || !context.grant.environmentIds.includes(service.environmentId)) return reply.code(404).send({ message: "服务不存在或无权访问" });
    return { ...accessSnapshot(store, service.id), gateMode: gate?.serviceId === service.id ? gate.mode : "unconfigured" };
  });
  app.post<{ Params: { id: string } }>(url, async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    if (context.grant.role !== "admin") return reply.code(403).send({ message: "仅管理员可修改维护访问控制" });
    const service = store.get(request.params.id);
    if (!service || !context.grant.environmentIds.includes(service.environmentId)) return reply.code(404).send({ message: "服务不存在或无权访问" });
    if (gate?.serviceId !== service.id) return reply.code(409).send({ message: "此服务尚未配置维护入口，请联系部署管理员" });
    const parsed = accessChangeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "请填写有效模式、IP / CIDR 白名单（最多 100 条，禁止 /0）、变更原因和版本" });
    const { version, idempotencyKey, ...input } = parsed.data;
    try { store.maintenanceAccess.save(service.id, input, version, idempotencyKey, context.principal.userId, request.id); return { ...accessSnapshot(store, service.id), gateMode: gate.mode }; }
    catch (error) { if (!(error instanceof AccessConflict)) throw error; return reply.code(409).send({ message: error.message }); }
  });
}
// Registered outside employee routes: ingress authenticates using an environment-injected secret.
export function registerMaintenanceGate(app: FastifyInstance, store: ServiceStore, gate: MaintenanceGate) {
  if (gate.token.length < 32 || !store.get(gate.serviceId)) throw new Error("Maintenance gate requires a registered service and a 32-character secret");
  app.get("/internal/maintenance-check", async (request, reply) => {
    const token = request.headers["x-maintenance-key"];
    if (typeof token !== "string" || Buffer.byteLength(token) !== Buffer.byteLength(gate.token) || !timingSafeEqual(Buffer.from(token), Buffer.from(gate.token))) return reply.code(403).send();
    try {
      const state = accessSnapshot(store, gate.serviceId);
      const ip = request.headers["x-maintenance-ip"];
      const allowed = !state.active || typeof ip === "string" && matchesAllowlist(ip, state.allowlist);
      return reply.code(allowed ? 204 : 403).send();
    } catch { return reply.code(503).send(); }
  });
}
