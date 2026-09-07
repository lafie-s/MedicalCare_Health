import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServiceStore } from "./service-store.js";
import type { Authorization } from "./service-routes.js";
import { AlertConflict } from "./alert-store.js";
import { serviceHealth } from "./probe.js";
export async function registerAlertRoutes(app: FastifyInstance, store: ServiceStore, authorize: Authorization) {
  app.get("/api/v1/alerts", async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    const parsed = z.object({ environmentId: z.string().min(1), state: z.enum(["active", "all", "firing", "acknowledged", "recovered", "closed", "terminated"]).default("active"), page: z.coerce.number().int().min(1).max(100000).default(1) }).strict().safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ message: "请选择有效的环境、告警状态和页码", code: "INVALID_REQUEST", requestId: request.id });
    if (!context.grant.environmentIds.includes(parsed.data.environmentId)) return reply.code(403).send({ message: "无权访问该环境", code: "FORBIDDEN", requestId: request.id });
    return store.alerts.environment(parsed.data.environmentId, parsed.data.state, parsed.data.page);
  });
  app.get<{ Params: { id: string }; Querystring: { page?: string } }>("/api/v1/services/:id/alerts", async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    const service = store.get(request.params.id);
    if (!service || !context.grant.environmentIds.includes(service.environmentId)) return reply.code(404).send({ message: "服务不存在或无权访问", code: "NOT_FOUND", requestId: request.id });
    const page = z.coerce.number().int().min(1).max(100000).safeParse(request.query.page ?? 1);
    if (!page.success) return reply.code(400).send({ message: "页码无效", code: "INVALID_REQUEST", requestId: request.id });
    const target = (context.policy.probeTargets ?? []).find((target) => target.id === service.targetId && target.environmentId === service.environmentId);
    return { ...store.alerts.list(service.id, page.data), rule: store.alerts.rule(service.id), health: serviceHealth(service, target, store), asOf: Date.now() };
  });
  app.put<{ Params: { id: string } }>("/api/v1/services/:id/alert-rule", async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    if (context.grant.role !== "admin") return reply.code(403).send({ message: "仅管理员可配置告警规则", code: "FORBIDDEN", requestId: request.id });
    const service = store.get(request.params.id);
    if (!service || !context.grant.environmentIds.includes(service.environmentId)) return reply.code(404).send({ message: "服务不存在或无权访问", code: "NOT_FOUND", requestId: request.id });
    const parsed = z.object({ failureCount: z.number().int().min(1).max(10), recoveryCount: z.number().int().min(1).max(10), severity: z.enum(["warning", "critical"]), enabled: z.boolean(), version: z.number().int().min(0) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "连续次数须为 1 至 10，请检查规则配置", code: "INVALID_REQUEST", requestId: request.id });
    const { version, ...input } = parsed.data;
    try { return store.alerts.saveRule(service.id, input, version, context.principal.userId, request.id); }
    catch (error) { if (!(error instanceof AlertConflict)) throw error; return reply.code(409).send({ message: "规则已变更，请关闭后重新打开告警面板", code: "CONFLICT", requestId: request.id }); }
  });
  for (const action of ["acknowledge", "close"] as const) app.post<{ Params: { id: string } }>(`/api/v1/alerts/:id/${action}`, async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    if (context.grant.role === "viewer") return reply.code(403).send({ message: "只读用户不能处理告警", code: "FORBIDDEN", requestId: request.id });
    const event = store.alerts.get(request.params.id); const service = event && store.get(event.serviceId);
    if (!service || !context.grant.environmentIds.includes(service.environmentId)) return reply.code(404).send({ message: "事件不存在或无权访问", code: "NOT_FOUND", requestId: request.id });
    try { return store.alerts.transition(request.params.id, action, context.principal.userId, request.id); }
    catch (error) { if (!(error instanceof AlertConflict)) throw error; return reply.code(409).send({ message: "事件状态已变化；仅触发事件可确认，仅已恢复事件可关闭，请刷新", code: "CONFLICT", requestId: request.id }); }
  });
}
