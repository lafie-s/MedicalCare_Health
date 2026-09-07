import { readFile } from "node:fs/promises";
import { z } from "zod";
import { isIP } from "node:net";

const environment = z.object({ id: z.string().regex(/^[a-z0-9-]{1,64}$/), name: z.string().min(1).max(80), type: z.enum(["development", "staging", "production"]) }).strict();
const grant = z.object({ userId: z.string().min(1).max(128), role: z.enum(["viewer", "operator", "admin"]), environmentIds: z.array(z.string()).min(1).max(100) }).strict();
const target = z.object({ id: z.string().regex(/^[a-z0-9-]{1,64}$/), environmentId: z.string(), name: z.string().min(1).max(80), url: z.url().max(500), address: z.string().refine((value) => isIP(value) !== 0) }).strict();
const schema = z.object({ environments: z.array(environment).max(100), grants: z.array(grant).max(1000), probeTargets: z.array(target).max(200).optional() }).strict();
export type AccessPolicy = z.infer<typeof schema>;
export type Grant = AccessPolicy["grants"][number];
export type ProbeTarget = z.infer<typeof target>;

export function parseAccessPolicy(value: unknown): AccessPolicy {
  const policy = schema.parse(value);
  const ids = new Set(policy.environments.map((item) => item.id));
  if (ids.size !== policy.environments.length || new Set(policy.grants.map((item) => item.userId)).size !== policy.grants.length) throw new Error("Duplicate environment or grant");
  if (policy.grants.some((item) => new Set(item.environmentIds).size !== item.environmentIds.length || item.environmentIds.some((id) => !ids.has(id)))) throw new Error("Invalid environment grant");
  const targets = policy.probeTargets ?? [];
  if (new Set(targets.map((item) => item.id)).size !== targets.length) throw new Error("Duplicate probe target");
  for (const item of targets) {
    const url = new URL(item.url);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!ids.has(item.environmentId) || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || (isIP(host) && host !== item.address)) throw new Error("Invalid probe target");
  }
  return policy;
}

// Read each request so an operator's access can be revoked without restarting.
export async function readAccessPolicy(path: string): Promise<AccessPolicy> {
  return parseAccessPolicy(JSON.parse(await readFile(path, "utf8")));
}
