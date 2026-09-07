// Pure health presentation rules shared by API and browser; no server dependencies.
export type HealthItem = { id: string; intervalSeconds: number; health: { reason: string; latest: { startedAt: number } | null } };
export const healthReasons: Record<string, string> = { disabled: "采集已停用", target_revoked: "目标授权已撤销", no_current_sample: "尚无当前配置的采样", stale: "数据已过期", interrupted: "采集被中断", success: "探测通过", http_error: "HTTP 响应异常", timeout: "探测超时", connection_error: "连接失败" };
export function currentHealth(item: HealthItem, now: number) {
  const { latest } = item.health;
  let reason = item.health.reason;
  if (!["disabled", "target_revoked", "no_current_sample"].includes(reason)) {
    if (!latest) reason = "no_current_sample";
    else if (now - latest.startedAt > item.intervalSeconds * 2000 + 5000) reason = "stale";
  }
  const status = reason === "disabled" ? "disabled" : reason === "success" ? "healthy" : ["http_error", "timeout", "connection_error"].includes(reason) ? "unhealthy" : "unknown";
  return { reason, status } as const;
}
export function summarizeHealth(items: HealthItem[], now: number) {
  const counts = { healthy: 0, unhealthy: 0, unknown: 0, disabled: 0 };
  let stale = 0;
  for (const item of items) { const health = currentHealth(item, now); counts[health.status]++; if (health.reason === "stale") stale++; }
  // Known failures remain visible even when other services have missing data.
  const status = counts.unhealthy ? "unhealthy" : !items.length || counts.unknown || counts.disabled ? "unknown" : "healthy";
  return { status, total: items.length, counts, stale, asOf: now };
}
