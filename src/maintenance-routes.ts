import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServiceStore } from "./service-store.js";
import type { Authorization } from "./service-routes.js";
import { MaintenanceConflict, MaintenanceInvalid } from "./maintenance-store.js";
export async function registerMaintenanceRoutes(app: FastifyInstance, store: ServiceStore, authorize: Authorization) {
  app.get<{ Params: { id: string }; Querystring: { page?: string } }>("/api/v1/services/:id/maintenance", async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    const service = store.get(request.params.id);
    if (!service || !context.grant.environmentIds.includes(service.environmentId)) return reply.code(404).send({ code: "NOT_FOUND", message: "服务不存在或无权访问", requestId: request.id });
    const parsed = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) }).strict().safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ code: "INVALID_REQUEST", message: "页码无效", requestId: request.id });
    return store.maintenance.list(service.id, parsed.data.page);
  });
  app.post<{ Params: { id: string } }>("/api/v1/services/:id/maintenance", async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    if (context.grant.role === "viewer") return reply.code(403).send({ code: "FORBIDDEN", message: "只读用户不能登记维护窗口", requestId: request.id });
    const service = store.get(request.params.id);
    if (!service || !context.grant.environmentIds.includes(service.environmentId)) return reply.code(404).send({ code: "NOT_FOUND", message: "服务不存在或无权访问", requestId: request.id });
    const parsed = z.object({ idempotencyKey: z.uuid(), startsAt: z.number().int(), endsAt: z.number().int(), owner: z.string().trim().min(1).max(80), reason: z.string().trim().min(1).max(500) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "INVALID_REQUEST", message: "请填写有效的时间、负责人和维护原因", requestId: request.id });
    const { idempotencyKey, ...input } = parsed.data;
    try { return reply.code(201).send(store.maintenance.create(idempotencyKey, { ...input, serviceId: service.id }, context.principal.userId, request.id)); }
    catch (error) { if (!(error instanceof MaintenanceConflict || error instanceof MaintenanceInvalid)) throw error; return reply.code(error instanceof MaintenanceInvalid ? 400 : 409).send({ code: "MAINTENANCE_REJECTED", message: error.message, requestId: request.id }); }
  });
  app.post<{ Params: { id: string } }>("/api/v1/maintenance/:id/cancel", async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    if (context.grant.role === "viewer") return reply.code(403).send({ code: "FORBIDDEN", message: "只读用户不能取消维护窗口", requestId: request.id });
    const window = store.maintenance.get(request.params.id); const service = window && store.get(window.serviceId);
    if (!service || !context.grant.environmentIds.includes(service.environmentId)) return reply.code(404).send({ code: "NOT_FOUND", message: "窗口不存在或无权访问", requestId: request.id });
    const parsed = z.object({ reason: z.string().trim().min(1).max(500) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "INVALID_REQUEST", message: "请填写取消原因", requestId: request.id });
    try { return store.maintenance.cancel(request.params.id, parsed.data.reason, context.principal.userId, request.id); }
    catch (error) { if (!(error instanceof MaintenanceConflict)) throw error; return reply.code(409).send({ code: "CONFLICT", message: error.message, requestId: request.id }); }
  });
}
