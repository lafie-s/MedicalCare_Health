import { z } from "zod";

const principalSchema = z.object({ userId: z.string().min(1).max(128), displayName: z.string().min(1).max(200), role: z.enum(["AGENT", "SUPERVISOR", "ADMIN"]) });
export type Principal = z.infer<typeof principalSchema>;
export type IdentityProvider = { verify: (token: string) => Promise<Principal | null>; ready: () => Promise<boolean>; login?: (email: string, password: string) => Promise<string | null> };
export class IdentityUnavailable extends Error {}

export function createIdentityProvider(baseUrl: string, timeoutMs = 3000): IdentityProvider {
  async function request(path: string, token?: string) {
    try {
      return await fetch(`${baseUrl}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch { throw new IdentityUnavailable("Identity service unavailable"); }
  }
  return {
    async login(email, password) {
      try {
        const response = await fetch(`${baseUrl}/auth/login`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(timeoutMs), redirect: "error",
        });
        if (response.status === 401) { await response.body?.cancel(); return null; }
        if (!response.ok) { await response.body?.cancel(); throw new IdentityUnavailable(); }
        const refreshCookie = response.headers.getSetCookie().find((value) => value.startsWith("hc_chat_refresh="))?.split(";")[0];
        if (!refreshCookie) { await response.body?.cancel(); throw new IdentityUnavailable(); }
        let token: string;
        try {
          const payload = z.object({ accessToken: z.string().min(1).max(8192) }).parse(await response.json());
          token = payload.accessToken;
        } finally {
          // This platform uses a short local session, so never retain an upstream refresh session.
          const logout = await fetch(`${baseUrl}/auth/logout`, { method: "POST", headers: { Cookie: refreshCookie }, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
          await logout.body?.cancel();
          if (!logout.ok) throw new IdentityUnavailable();
        }
        return token;
      } catch { throw new IdentityUnavailable("Employee login unavailable"); }
    },
    async verify(token) {
      const response = await request("/auth/me", token);
      if (response.status === 401 || response.status === 403) { await response.body?.cancel(); return null; }
      if (!response.ok) { await response.body?.cancel(); throw new IdentityUnavailable("Identity service unavailable"); }
      try {
        const result = principalSchema.safeParse(await response.json());
        if (!result.success) throw new IdentityUnavailable("Invalid identity response");
        return result.data;
      } catch { throw new IdentityUnavailable("Invalid identity response"); }
    },
    async ready() {
      try {
        const response = await request("/health/ready");
        await response.body?.cancel();
        return response.ok;
      } catch { return false; }
    },
  };
}
