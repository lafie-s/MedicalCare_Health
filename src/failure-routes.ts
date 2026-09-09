import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServiceStore } from "./service-store.js";
import type { Authorization } from "./service-routes.js";
export async function registerFailureRoutes(app: FastifyInstance, store: ServiceStore, authorize: Authorization) {
  app.get<{ Params: { id: string }; Querystring: { page?: string } }>("/api/v1/services/:id/failure-logs", async (request, reply) => {
    const context = await authorize(request, reply); if (!context) return;
    const service = store.get(request.params.id);
    if (!service || !context.grant.environmentIds.includes(service.environmentId)) return reply.code(404).send({ message: "服务不存在或无权访问" });
    const query = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) }).strict().safeParse(request.query);
    if (!query.success) return reply.code(400).send({ message: "页码无效" });
    return store.failureLogs.list(service.id, query.data.page);
  });
}
