import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccessPolicy } from "./access-policy.js";
import type { IdentityProvider } from "./identity.js";
import { IdentityUnavailable } from "./identity.js";
import type { SessionStore } from "./session-store.js";
import { z } from "zod";

export interface AuthDependencies {
  identity: IdentityProvider;
  store: SessionStore;
  policy: () => Promise<AccessPolicy>;
  origin: string;
  secureCookie: boolean;
}
const COOKIE = "mc_health_session";

export async function registerAuthRoutes(app: FastifyInstance, deps: AuthDependencies) {
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 120, timeWindow: "1 minute" });
  const cookieOptions = { path: "/api/v1", httpOnly: true, secure: deps.secureCookie, sameSite: "strict" as const };
  const fail = (request: FastifyRequest, reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ code, message, requestId: request.id });

  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "GET" && request.method !== "HEAD" && request.headers.origin !== deps.origin) {
      return fail(request, reply, 403, "INVALID_ORIGIN", "请从平台页面发起操作");
    }
  });

  app.post("/api/v1/auth/login", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = z.object({ email: z.email().max(254), password: z.string().min(1).max(256) }).strict().safeParse(request.body);
    if (!body.success) return fail(request, reply, 400, "INVALID_REQUEST", "请输入有效邮箱和密码");
    if (!deps.identity.login) return fail(request, reply, 503, "LOGIN_UNAVAILABLE", "员工登录尚未配置，请联系管理员");
    try {
      const token = await deps.identity.login(body.data.email, body.data.password);
      const principal = token ? await deps.identity.verify(token) : null;
      if (!token || !principal) return fail(request, reply, 401, "INVALID_CREDENTIALS", "邮箱或密码不正确，请重新输入");
      const policy = await deps.policy();
      const grant = policy.grants.find((item) => item.userId === principal.userId);
      if (!grant) {
        deps.store.audit(principal.userId, "session.denied", request.id);
        return fail(request, reply, 403, "FORBIDDEN", "尚未获得平台运维权限，请联系管理员");
      }
      const session = deps.store.create(principal.userId, token, request.id);
      reply.setCookie(COOKIE, session.id, { ...cookieOptions, maxAge: 900 });
      return { expiresAt: new Date(session.expiresAt).toISOString() };
    } catch { return fail(request, reply, 503, "AUTH_UNAVAILABLE", "身份或权限服务暂不可用，请稍后重试"); }
  });

  app.post("/api/v1/auth/session", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const match = /^Bearer ([A-Za-z0-9._~-]{1,8192})$/.exec(request.headers.authorization ?? "");
    if (!match?.[1]) return fail(request, reply, 401, "UNAUTHORIZED", "请先通过 MedicalCareWeb 员工身份认证");
    try {
      const principal = await deps.identity.verify(match[1]);
      if (!principal) return fail(request, reply, 401, "UNAUTHORIZED", "员工凭据无效或已过期");
      const policy = await deps.policy();
      const grant = policy.grants.find((item) => item.userId === principal.userId);
      if (!grant) {
        deps.store.audit(principal.userId, "session.denied", request.id);
        return fail(request, reply, 403, "FORBIDDEN", "尚未获得平台运维权限，请联系管理员");
      }
      const session = deps.store.create(principal.userId, match[1], request.id);
      reply.setCookie(COOKIE, session.id, { ...cookieOptions, maxAge: 900 });
      return { user: { userId: principal.userId, displayName: principal.displayName, role: grant.role }, expiresAt: new Date(session.expiresAt).toISOString() };
    } catch {
      return fail(request, reply, 503, "AUTH_UNAVAILABLE", "身份或权限服务暂不可用，请稍后重试");
    }
  });

  // Logout is local and remains available when the identity provider is offline.
  app.post("/api/v1/auth/logout", async (request, reply) => {
    const id = request.cookies[COOKIE];
    if (id) deps.store.revoke(id, request.id);
    reply.clearCookie(COOKIE, cookieOptions);
    return reply.code(204).send();
  });

  async function authorize(request: FastifyRequest, reply: FastifyReply) {
    const id = request.cookies[COOKIE];
    if (!id) { fail(request, reply, 401, "UNAUTHORIZED", "请先登录运维平台"); return null; }
    try {
      const session = deps.store.find(id);
      if (!session) { reply.clearCookie(COOKIE, cookieOptions); fail(request, reply, 401, "SESSION_EXPIRED", "会话已失效，请重新登录"); return null; }
      const policy = await deps.policy();
      const grant = policy.grants.find((item) => item.userId === session.userId);
      if (!grant) {
        deps.store.revoke(id, request.id);
        reply.clearCookie(COOKIE, cookieOptions);
        fail(request, reply, 403, "FORBIDDEN", "运维权限已撤销"); return null;
      }
      const principal = await deps.identity.verify(session.token);
      if (!principal || principal.userId !== session.userId) {
        deps.store.revoke(id, request.id);
        reply.clearCookie(COOKIE, cookieOptions);
        fail(request, reply, 401, "SESSION_EXPIRED", "员工凭据已失效，请重新登录"); return null;
      }
      return { principal, grant, policy, expiresAt: session.expiresAt };
    } catch (error) {
      fail(request, reply, 503, error instanceof IdentityUnavailable ? "IDENTITY_UNAVAILABLE" : "AUTH_UNAVAILABLE", "身份或权限服务暂不可用，请稍后重试");
      return null;
    }
  }

  app.get("/api/v1/me", async (request, reply) => {
    const context = await authorize(request, reply);
    if (!context) return;
    return { userId: context.principal.userId, displayName: context.principal.displayName, role: context.grant.role, environmentIds: context.grant.environmentIds, expiresAt: new Date(context.expiresAt).toISOString() };
  });
  app.get("/api/v1/environments", async (request, reply) => {
    const context = await authorize(request, reply);
    if (!context) return;
    return { items: context.policy.environments.filter((item) => context.grant.environmentIds.includes(item.id)) };
  });
  app.get<{ Params: { id: string } }>("/api/v1/environments/:id", async (request, reply) => {
    const context = await authorize(request, reply);
    if (!context) return;
    if (!context.grant.environmentIds.includes(request.params.id)) return fail(request, reply, 403, "FORBIDDEN", "无权访问该环境");
    return context.policy.environments.find((item) => item.id === request.params.id);
  });
}
