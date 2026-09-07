import type { DatabaseSync } from "node:sqlite";
export interface MaintenanceInput { serviceId: string; startsAt: number; endsAt: number; owner: string; reason: string }
export interface MaintenanceWindow extends MaintenanceInput { id: string; createdBy: string; createdAt: number; canceledAt: number | null; cancelReason: string | null; status: "scheduled" | "active" | "ended" | "canceled" }
export class MaintenanceConflict extends Error {}
export class MaintenanceInvalid extends Error {}
export class MaintenanceStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS maintenance_windows (id TEXT PRIMARY KEY, service_id TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, owner TEXT NOT NULL, reason TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, canceled_at INTEGER, cancel_reason TEXT);
      CREATE INDEX IF NOT EXISTS service_maintenance ON maintenance_windows(service_id, starts_at DESC);`);
  }
  private transaction<T>(action: () => T): T { this.db.exec("BEGIN IMMEDIATE"); try { const value = action(); this.db.exec("COMMIT"); return value; } catch (error) { this.db.exec("ROLLBACK"); throw error; } }
  private audit(actor: string, action: string, requestId: string) { this.db.prepare("INSERT INTO audit_events(actor, action, request_id, created_at) VALUES (?, ?, ?, ?)").run(actor, action, requestId, Date.now()); }
  private map(row: Record<string, unknown>, now: number): MaintenanceWindow {
    const startsAt = Number(row.starts_at); const endsAt = Number(row.ends_at); const canceledAt = row.canceled_at === null ? null : Number(row.canceled_at);
    return { id: String(row.id), serviceId: String(row.service_id), startsAt, endsAt, owner: String(row.owner), reason: String(row.reason), createdBy: String(row.created_by), createdAt: Number(row.created_at), canceledAt, cancelReason: row.cancel_reason === null ? null : String(row.cancel_reason), status: canceledAt !== null ? "canceled" : now < startsAt ? "scheduled" : now >= endsAt ? "ended" : "active" };
  }
  get(id: string, now = Date.now()) { const row = this.db.prepare("SELECT * FROM maintenance_windows WHERE id=?").get(id); return row ? this.map(row, now) : null; }
  active(serviceId: string, now: number) { return Number(this.db.prepare("SELECT COUNT(*) AS total FROM maintenance_windows WHERE service_id=? AND canceled_at IS NULL AND starts_at<=? AND ends_at>?").get(serviceId, now, now)!.total); }
  next(serviceId: string, now: number) {
    const row = this.db.prepare("SELECT starts_at, ends_at FROM maintenance_windows WHERE service_id=? AND canceled_at IS NULL AND ends_at>? ORDER BY starts_at LIMIT 1").get(serviceId, now);
    return row ? { startsAt: Number(row.starts_at), endsAt: Number(row.ends_at) } : null;
  }
  list(serviceId: string, requestedPage: number, now = Date.now()) {
    const total = Number(this.db.prepare("SELECT COUNT(*) AS total FROM maintenance_windows WHERE service_id=?").get(serviceId)!.total);
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / 20)));
    const items = this.db.prepare("SELECT * FROM maintenance_windows WHERE service_id=? ORDER BY starts_at DESC, id DESC LIMIT 20 OFFSET ?").all(serviceId, (page - 1) * 20).map((row) => this.map(row, now));
    return { total, page, pageSize: 20, asOf: now, items };
  }
  create(id: string, input: MaintenanceInput, actor: string, requestId: string, now = Date.now()) {
    return this.transaction(() => {
      const existing = this.get(id, now);
      if (existing) {
        if (existing.createdBy === actor && Object.entries(input).every(([key, value]) => existing[key as keyof MaintenanceInput] === value)) return existing;
        throw new MaintenanceConflict("请求标识已被其他记录使用");
      }
      if (!Number.isSafeInteger(input.startsAt) || !Number.isSafeInteger(input.endsAt) || input.startsAt < now || input.startsAt > now + 30 * 86_400_000 || input.endsAt <= input.startsAt || input.endsAt - input.startsAt > 86_400_000) throw new MaintenanceInvalid("开始时间须在未来 30 天内，结束须晚于开始，窗口最长 24 小时");
      if (this.db.prepare("SELECT id FROM maintenance_windows WHERE service_id=? AND canceled_at IS NULL AND starts_at<? AND ends_at>?").get(input.serviceId, input.endsAt, input.startsAt)) throw new MaintenanceConflict("与该服务已有维护窗口重叠，请调整时间");
      this.db.prepare("INSERT INTO maintenance_windows(id,service_id,starts_at,ends_at,owner,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)").run(id, input.serviceId, input.startsAt, input.endsAt, input.owner, input.reason, actor, now);
      this.audit(actor, `maintenance.created:${id}`, requestId); return this.get(id, now)!;
    });
  }
  cancel(id: string, reason: string, actor: string, requestId: string, now = Date.now()) {
    return this.transaction(() => {
      const existing = this.get(id, now);
      if (!existing) throw new MaintenanceConflict("维护窗口不存在");
      if (existing.status === "canceled") return existing;
      if (existing.status === "ended") throw new MaintenanceConflict("窗口已结束，不能取消历史记录");
      this.db.prepare("UPDATE maintenance_windows SET canceled_at=?, cancel_reason=? WHERE id=?").run(now, reason, id);
      this.audit(actor, `maintenance.canceled:${id}`, requestId); return this.get(id, now)!;
    });
  }
}
