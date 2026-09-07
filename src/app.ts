import Fastify, { LogController } from "fastify";
import { registerAuthRoutes, type AuthDependencies } from "./auth-routes.js";

export function buildApp(auth?: AuthDependencies) {
  const app = Fastify({
    bodyLimit: 16_384,
    logger: { level: "info", redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"] },
    logController: new LogController({ disableRequestLogging: true }),
  });

  app.addHook("onSend", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
  });
  app.setErrorHandler((error, request, reply) => {
    const candidate = error && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
    const status = typeof candidate === "number" && candidate >= 400 && candidate < 500 ? candidate : 500;
    return reply.code(status).send({ code: status === 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST", message: status === 500 ? "服务暂时无法处理请求" : "请求格式不正确", requestId: request.id });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ code: "NOT_FOUND", message: "接口不存在", requestId: request.id }));
  app.get("/health/live", async () => ({ status: "ok", service: "medicalcare-health" }));
  app.get("/health/ready", async (_request, reply) => {
    if (!auth) return reply.code(503).send({ status: "unavailable", reason: "NOT_CONFIGURED" });
    try {
      const policy = await auth.policy();
      const ready = auth.store.ready() && policy.grants.length > 0 && await auth.identity.ready();
      return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "unavailable" });
    } catch { return reply.code(503).send({ status: "unavailable" }); }
  });
  if (auth) app.register(registerAuthRoutes, auth);
  return app;
}
