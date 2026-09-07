import assert from "node:assert/strict";
import test from "node:test";
import { currentHealth, summarizeHealth, type HealthItem } from "../src/health-summary.js";
const now = 1_000_000;
const item = (reason: string, age = 0): HealthItem => ({ id: reason, intervalSeconds: 30, health: { reason, latest: { startedAt: now - age } } });
test("overview retains known failures alongside unknown and disabled services", () => {
  const result = summarizeHealth([item("success"), item("timeout"), item("no_current_sample"), item("disabled"), item("success", 65_001)], now);
  assert.equal(result.status, "unhealthy");
  assert.deepEqual(result.counts, { healthy: 1, unhealthy: 1, unknown: 2, disabled: 1 });
  assert.equal(result.stale, 1);
});
test("overview never reports empty or incomplete monitoring as healthy", () => {
  for (const items of [[], [item("disabled")], [item("success"), item("target_revoked")], [item("success"), item("disabled")]]) assert.equal(summarizeHealth(items, now).status, "unknown");
  assert.equal(summarizeHealth([item("success")], now).status, "healthy");
});
test("summary and details share exact freshness boundary and recovery", () => {
  assert.equal(currentHealth(item("success", 65_000), now).status, "healthy");
  assert.equal(currentHealth(item("http_error", 65_001), now).reason, "stale");
  assert.equal(currentHealth(item("disabled", 99_000), now).reason, "disabled");
  assert.equal(currentHealth({ ...item("success"), health: { reason: "success", latest: null } }, now).status, "unknown");
  assert.equal(summarizeHealth([item("success")], now).counts.unhealthy, 0);
});
