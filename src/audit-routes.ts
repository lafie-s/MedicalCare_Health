import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServiceStore } from "./service-store.js";
import type { Authorization } from "./service-routes.js";

export async function registerAuditRoutes(app: FastifyInstance, store: ServiceStore, authorize: Authorization) {
  app.get("/api/v1/audit", async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    if (context.grant.role !== "admin") return reply.code(403).send({ code: "FORBIDDEN", message: "仅管理员可查询审计记录", requestId: request.id });
    const now = Date.now();
    const parsed = z.object({ environmentId: z.string().min(1), from: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(now - 86_400_000), to: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(now), page: z.coerce.number().int().min(1).max(100000).default(1), category: z.enum(["all", "service", "probe", "alert", "maintenance", "release", "recovery"]).default("all") }).strict().safeParse(request.query);
    if (!parsed.success || parsed.data.to <= parsed.data.from || parsed.data.to - parsed.data.from > 31 * 86_400_000) return reply.code(400).send({ code: "INVALID_REQUEST", message: "查询时间须递增且不超过 31 天，页码与操作类型须有效", requestId: request.id });
    if (!context.grant.environmentIds.includes(parsed.data.environmentId)) return reply.code(403).send({ code: "FORBIDDEN", message: "无权查询该环境", requestId: request.id });
    return store.auditLog.query(parsed.data);
  });
}
