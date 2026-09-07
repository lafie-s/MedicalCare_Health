import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AccessPolicy, Grant } from "./access-policy.js";
import { ServiceConflict, ServiceLimit, type ServiceStore } from "./service-store.js";
import { ProbeRejected, serviceHealth, type ProbeRunner } from "./probe.js";
import { summarizeHealth } from "./health-summary.js";
import { probeTrend, type TrendHours } from "./probe-trend.js";
import { targetFingerprint } from "./probe.js";

export type Authorization = (request: FastifyRequest, reply: FastifyReply) => Promise<{ principal: { userId: string }; grant: Grant; policy: AccessPolicy } | null>;
const input = z.object({ name: z.string().trim().min(1).max(80), owner: z.string().trim().min(1).max(80), targetId: z.string().min(1).max(64), intervalSeconds: z.union([z.literal(30), z.literal(60), z.literal(300)]) });
export async function registerServiceRoutes(app: FastifyInstance, store: ServiceStore, authorize: Authorization, runner?: ProbeRunner) {
  const fail = (request: FastifyRequest, reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ code, message, requestId: request.id });
  for (const path of ["/api/v1/services", "/api/v1/health/overview"]) app.get<{ Querystring: { environmentId?: string } }>(path, async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    const environmentId = request.query.environmentId;
    if (!environmentId || !context.grant.environmentIds.includes(environmentId)) return fail(request, reply, 403, "FORBIDDEN", "无权访问该环境");
    const targets = (context.policy.probeTargets ?? []).filter((target) => target.environmentId === environmentId);
    const asOf = Date.now();
    const items = store.list(environmentId).map((service) => ({ ...service, health: serviceHealth(service, targets.find((target) => target.id === service.targetId), store, asOf) }));
    return { items, overview: summarizeHealth(items, asOf), asOf, targets: targets.map(({ id, name }) => ({ id, name })), limit: 100, probingAvailable: Boolean(runner) };
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
  app.get<{ Params: { id: string }; Querystring: { hours?: string } }>("/api/v1/services/:id/trend", async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    const service = store.get(request.params.id);
    if (!service || !context.grant.environmentIds.includes(service.environmentId)) return fail(request, reply, 404, "NOT_FOUND", "服务不存在或无权访问");
    const query = z.object({ hours: z.enum(["1", "6", "24"]).default("1") }).strict().safeParse(request.query);
    if (!query.success) return fail(request, reply, 400, "INVALID_RANGE", "请选择最近 1、6 或 24 小时");
    const target = (context.policy.probeTargets ?? []).find((target) => target.environmentId === service.environmentId && target.id === service.targetId);
    return { ...probeTrend(store, service, target ? targetFingerprint(target) : undefined, Number(query.data.hours) as TrendHours), targetAvailable: Boolean(target), enabled: service.enabled };
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
  app.post<{ Params: { id: string } }>("/api/v1/services/:id/probe", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    if (context.grant.role === "viewer") return fail(request, reply, 403, "FORBIDDEN", "只读用户不能发起探测");
    const service = store.get(request.params.id);
    if (!service || !context.grant.environmentIds.includes(service.environmentId)) return fail(request, reply, 404, "NOT_FOUND", "服务不存在或无权访问");
    const key = z.uuid().safeParse(request.headers["idempotency-key"]);
    if (!key.success) return fail(request, reply, 400, "INVALID_REQUEST", "探测请求缺少有效的幂等标识");
    if (!runner) return fail(request, reply, 503, "PROBING_UNAVAILABLE", "探测器尚未启动");
    try {
      const result = await runner.run(service.id, key.data, context.principal.userId, request.id);
      return reply.code(result.outcome === "running" ? 202 : 200).send(result);
    } catch (error) {
      if (error instanceof ProbeRejected) return fail(request, reply, 409, error.code, error.code === "BUSY" ? "探测正在执行或尚未到下次采集时间，请稍后刷新" : error.code === "DISABLED" ? "服务已停用，请先启用" : error.code === "TARGET_REVOKED" ? "探测目标授权已撤销" : "探测请求标识冲突，请刷新后重试");
      return fail(request, reply, 503, "PROBE_UNAVAILABLE", "无法读取探测配置或保存结果，请稍后重试");
    }
  });
}
