import { readFile } from "node:fs/promises";
import { z } from "zod";

const environment = z.object({ id: z.string().regex(/^[a-z0-9-]{1,64}$/), name: z.string().min(1).max(80), type: z.enum(["development", "staging", "production"]) }).strict();
const grant = z.object({ userId: z.string().min(1).max(128), role: z.enum(["viewer", "operator", "admin"]), environmentIds: z.array(z.string()).min(1).max(100) }).strict();
const schema = z.object({ environments: z.array(environment).max(100), grants: z.array(grant).max(1000) }).strict();
export type AccessPolicy = z.infer<typeof schema>;
export type Grant = AccessPolicy["grants"][number];

export function parseAccessPolicy(value: unknown): AccessPolicy {
  const policy = schema.parse(value);
  const ids = new Set(policy.environments.map((item) => item.id));
  if (ids.size !== policy.environments.length || new Set(policy.grants.map((item) => item.userId)).size !== policy.grants.length) throw new Error("Duplicate environment or grant");
  if (policy.grants.some((item) => new Set(item.environmentIds).size !== item.environmentIds.length || item.environmentIds.some((id) => !ids.has(id)))) throw new Error("Invalid environment grant");
  return policy;
}

// Read each request so an operator's access can be revoked without restarting.
export async function readAccessPolicy(path: string): Promise<AccessPolicy> {
  return parseAccessPolicy(JSON.parse(await readFile(path, "utf8")));
}
