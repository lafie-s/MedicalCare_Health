import { BlockList, isIP } from "node:net";
import { z } from "zod";
export function parseNetwork(value: string) {
  const [address, bits, extra] = value.split("/");
  if (!address || extra !== undefined || address.includes("%")) throw new Error("无效 IP 或网段");
  const family = isIP(address); if (!family) throw new Error("无效 IP 地址");
  const prefix = bits === undefined ? (family === 4 ? 32 : 128) : /^\d{1,3}$/.test(bits) ? Number(bits) : -1;
  if (prefix < 1 || prefix > (family === 4 ? 32 : 128)) throw new Error("网段前缀无效，不能放行全部地址");
  const type = family === 4 ? "ipv4" as const : "ipv6" as const;
  const list = new BlockList(); list.addSubnet(address, prefix, type);
  return { address, prefix, type };
}
export const accessInputSchema = z.object({
  mode: z.enum(["off", "manual", "window"]),
  allowlist: z.array(z.string().trim().min(1).max(64).refine((value) => { try { parseNetwork(value); return true; } catch { return false; } }, "请输入有效 IPv4、IPv6 或 CIDR 网段，不能使用 /0")).max(100).transform((items) => [...new Set(items.map((item) => item.toLowerCase()))]),
  reason: z.string().trim().min(1).max(500),
});
export const accessChangeSchema = accessInputSchema.extend({ version: z.number().int().min(0), idempotencyKey: z.uuid() });
export type AccessInput = z.infer<typeof accessInputSchema>;
export function matchesAllowlist(ip: string, entries: string[]) {
  if (ip.includes("%") || !isIP(ip)) return false;
  const list = new BlockList(); for (const entry of entries) { const network = parseNetwork(entry); list.addSubnet(network.address, network.prefix, network.type); }
  return list.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
}
