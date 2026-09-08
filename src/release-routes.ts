import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServiceStore } from "./service-store.js";
import type { Authorization } from "./service-routes.js";
import type { ReleaseManager } from "./release-manager.js";
import { ReleaseConflict } from "./release-store.js";
export async function registerReleaseRoutes(app: FastifyInstance, store: ServiceStore, authorize: Authorization, manager?: ReleaseManager) {
  app.get<{ Params: { id: string } }>("/api/v1/services/:id/releases", async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    const service = store.get(request.params.id);
    if (!service || !context.grant.environmentIds.includes(service.environmentId)) return reply.code(404).send({ message: "服务不存在或无权访问" });
    if (!manager || manager.serviceId !== service.id) return { available: false, message: "尚未配置该网站的已批准版本目录和发布执行器" };
    try { return { available: true, ...await manager.snapshot() }; } catch { return reply.code(503).send({ message: "无法核对部署版本，请检查执行器连接" }); }
  });
  for (const operation of ["release", "release-reconcile"] as const) app.post<{ Params: { id: string } }>(`/api/v1/services/:id/${operation}`, async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    if (context.grant.role !== "admin") return reply.code(403).send({ message: "仅管理员可执行网站版本更新或回退" });
    const service = store.get(request.params.id);
    if (!service || !context.grant.environmentIds.includes(service.environmentId)) return reply.code(404).send({ message: "服务不存在或无权访问" });
    if (!manager || manager.serviceId !== service.id) return reply.code(503).send({ message: "发布执行器尚未配置" });
    try {
      if (operation === "release-reconcile") {
        if (!z.object({ executionStopped: z.literal(true) }).strict().safeParse(request.body).success) return reply.code(400).send({ message: "须先由部署人员确认上次执行已停止" });
        return await manager.reconcile(context.principal.userId);
      }
      const parsed = z.object({ id: z.uuid(), to: z.string().min(1).max(64), expected: z.string().min(1).max(64), action: z.enum(["update", "rollback"]), reason: z.string().trim().min(1).max(500), backupReference: z.string().trim().min(1).max(200) }).strict().safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ message: "请填写版本、变更原因和备份/恢复验证记录编号" });
      return reply.code(202).send(await manager.start(parsed.data, context.principal.userId));
    } catch (error) { return reply.code(error instanceof ReleaseConflict ? 409 : 503).send({ message: error instanceof ReleaseConflict ? error.message : "发布服务暂不可用，请刷新任务状态后重试" }); }
  });
}
