import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AccessPolicy, Grant } from "./access-policy.js";
import { ServiceConflict, ServiceLimit, type ServiceStore } from "./service-store.js";

export type Authorization = (request: FastifyRequest, reply: FastifyReply) => Promise<{ principal: { userId: string }; grant: Grant; policy: AccessPolicy } | null>;
const input = z.object({ name: z.string().trim().min(1).max(80), owner: z.string().trim().min(1).max(80), targetId: z.string().min(1).max(64), intervalSeconds: z.union([z.literal(30), z.literal(60), z.literal(300)]) });
export async function registerServiceRoutes(app: FastifyInstance, store: ServiceStore, authorize: Authorization) {
  const fail = (request: FastifyRequest, reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ code, message, requestId: request.id });
  app.get<{ Querystring: { environmentId?: string } }>("/api/v1/services", async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    const environmentId = request.query.environmentId;
    if (!environmentId || !context.grant.environmentIds.includes(environmentId)) return fail(request, reply, 403, "FORBIDDEN", "无权访问该环境");
    return { items: store.list(environmentId), targets: (context.policy.probeTargets ?? []).filter((target) => target.environmentId === environmentId).map(({ id, name }) => ({ id, name })), limit: 100 };
  });
  app.post("/api/v1/services", async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    if (context.grant.role !== "admin") return fail(request, reply, 403, "FORBIDDEN", "仅管理员可以维护服务配置");
    const body = input.extend({ environmentId: z.string(), idempotencyKey: z.uuid() }).strict().safeParse(request.body);
    if (!body.success) return fail(request, reply, 400, "INVALID_REQUEST", "请填写服务名称、负责人并选择有效的采集配置");
    const data = body.data;
    if (!context.grant.environmentIds.includes(data.environmentId)) return fail(request, reply, 403, "FORBIDDEN", "无权访问该环境");
    if (!(context.policy.probeTargets ?? []).some((target) => target.id === data.targetId && target.environmentId === data.environmentId)) return fail(request, reply, 400, "INVALID_TARGET", "请选择当前环境内获准探测的目标");
    try { return reply.code(201).send(store.create(data.idempotencyKey, data.environmentId, data, context.principal.userId, request.id)); }
    catch (error) {
      if (error instanceof ServiceConflict) return fail(request, reply, 409, "CONFLICT", "该目标已登记或请求已变更，请刷新列表后重试");
      if (error instanceof ServiceLimit) return fail(request, reply, 409, "LIMIT_REACHED", "当前环境已达到 100 个服务上限");
      throw error;
    }
  });
  app.patch<{ Params: { id: string } }>("/api/v1/services/:id", async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    if (context.grant.role !== "admin") return fail(request, reply, 403, "FORBIDDEN", "仅管理员可以维护服务配置");
    const service = store.get(request.params.id);
    if (!service || !context.grant.environmentIds.includes(service.environmentId)) return fail(request, reply, 404, "NOT_FOUND", "服务不存在或无权访问");
    const body = input.partial().extend({ enabled: z.boolean().optional(), version: z.number().int().positive() }).strict().safeParse(request.body);
    if (!body.success || Object.keys(body.data).length < 2) return fail(request, reply, 400, "INVALID_REQUEST", "请提供有效的配置及版本号");
    const data = { ...service, name: body.data.name ?? service.name, owner: body.data.owner ?? service.owner, targetId: body.data.targetId ?? service.targetId, intervalSeconds: body.data.intervalSeconds ?? service.intervalSeconds, enabled: body.data.enabled ?? service.enabled };
    // Revoked targets can still be disabled, but cannot be enabled or reconfigured for probing.
    if (data.enabled && !(context.policy.probeTargets ?? []).some((target) => target.id === data.targetId && target.environmentId === data.environmentId)) return fail(request, reply, 400, "INVALID_TARGET", "该探测目标未获授权，请先更新白名单");
    try { return store.update(service.id, body.data.version, data, context.principal.userId, request.id); }
    catch (error) { if (error instanceof ServiceConflict) return fail(request, reply, 409, "CONFLICT", "配置已被其他操作修改，请刷新后重试"); throw error; }
  });
}
