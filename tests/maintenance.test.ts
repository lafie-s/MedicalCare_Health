import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { ServiceStore } from "../src/service-store.js";
import { MaintenanceConflict, MaintenanceInvalid } from "../src/maintenance-store.js";
function setup(path = ":memory:") {
  const store = new ServiceStore(path); const service = store.create(randomUUID(), "local", { name: "service", owner: "ops", targetId: "target", intervalSeconds: 30 }, "ops", "test");
  const now = Date.now(); const input = { serviceId: service.id, startsAt: now + 60_000, endsAt: now + 3600_000, owner: "ops", reason: "scheduled inspection" };
  return { store, service, now, input };
}
test("maintenance uses [start,end), rejects overlap and preserves probe configuration", (t) => {
  const ctx = setup(); t.after(() => ctx.store.close()); const id = randomUUID();
  ctx.store.maintenance.create(id, ctx.input, "ops", "test", ctx.now);
  assert.equal(ctx.store.maintenance.get(id, ctx.input.startsAt - 1)!.status, "scheduled");
  assert.equal(ctx.store.maintenance.active(ctx.service.id, ctx.input.startsAt), 1);
  assert.equal(ctx.store.maintenance.active(ctx.service.id, ctx.input.endsAt), 0);
  assert.equal(ctx.store.maintenance.get(id, ctx.input.endsAt)!.status, "ended");
  assert.equal(ctx.store.get(ctx.service.id)!.enabled, true); assert.equal(ctx.store.get(ctx.service.id)!.version, 1);
  assert.throws(() => ctx.store.maintenance.create(randomUUID(), ctx.input, "ops", "test", ctx.now), MaintenanceConflict);
  assert.ok(ctx.store.maintenance.create(randomUUID(), { ...ctx.input, startsAt: ctx.input.endsAt, endsAt: ctx.input.endsAt + 60_000 }, "ops", "test", ctx.now));
  assert.deepEqual(ctx.store.maintenance.next(ctx.service.id, ctx.input.startsAt), { startsAt: ctx.input.startsAt, endsAt: ctx.input.endsAt });
});
test("maintenance retries are idempotent, cancellation is immediate and expired windows immutable", (t) => {
  const ctx = setup(); t.after(() => ctx.store.close()); const id = randomUUID();
  ctx.store.maintenance.create(id, ctx.input, "ops", "test", ctx.now);
  assert.equal(ctx.store.maintenance.create(id, ctx.input, "ops", "retry", ctx.input.endsAt + 1).id, id);
  assert.throws(() => ctx.store.maintenance.create(id, { ...ctx.input, reason: "changed" }, "ops", "retry", ctx.now), MaintenanceConflict);
  assert.throws(() => ctx.store.maintenance.cancel(id, "late", "ops", "cancel", ctx.input.endsAt), MaintenanceConflict);
  ctx.store.maintenance.cancel(id, "plan changed", "ops", "cancel", ctx.input.startsAt);
  assert.equal(ctx.store.maintenance.cancel(id, "retry", "other", "retry", ctx.input.startsAt + 1).cancelReason, "plan changed");
  assert.equal(ctx.store.maintenance.active(ctx.service.id, ctx.input.startsAt), 0);
  assert.equal(ctx.store.maintenance.list(ctx.service.id, 999, ctx.now).page, 1);
});
test("maintenance validates future start, duration and planning horizon", (t) => {
  const ctx = setup(); t.after(() => ctx.store.close());
  for (const input of [{ ...ctx.input, startsAt: ctx.now - 1 }, { ...ctx.input, endsAt: ctx.input.startsAt }, { ...ctx.input, endsAt: ctx.input.startsAt + 86_400_001 }, { ...ctx.input, startsAt: ctx.now + 31 * 86_400_000 }]) assert.throws(() => ctx.store.maintenance.create(randomUUID(), input, "ops", "test", ctx.now), MaintenanceInvalid);
});
test("maintenance persists and audit failures roll back cancellation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "medicalcare-maintenance-")); const path = join(directory, "state.sqlite");
  const ctx = setup(path); const id = randomUUID(); ctx.store.maintenance.create(id, ctx.input, "ops", "test", ctx.now); ctx.store.close();
  const store = new ServiceStore(path); const inspect = new DatabaseSync(path);
  t.after(async () => { inspect.close(); store.close(); assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + "medicalcare-maintenance-")); await rm(directory, { recursive: true, force: true }); });
  assert.equal(store.maintenance.get(id)!.reason, ctx.input.reason);
  inspect.exec("CREATE TRIGGER reject_maintenance BEFORE INSERT ON audit_events WHEN NEW.action LIKE 'maintenance.canceled:%' BEGIN SELECT RAISE(ABORT, 'test'); END;");
  assert.throws(() => store.maintenance.cancel(id, "test", "ops", "cancel", ctx.now));
  assert.equal(store.maintenance.get(id)!.canceledAt, null);
});
