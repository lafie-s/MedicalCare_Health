import { z } from "zod";

const principalSchema = z.object({ userId: z.string().min(1).max(128), displayName: z.string().min(1).max(200), role: z.enum(["AGENT", "SUPERVISOR", "ADMIN"]) });
export type Principal = z.infer<typeof principalSchema>;
export type IdentityProvider = { verify: (token: string) => Promise<Principal | null>; ready: () => Promise<boolean> };
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
