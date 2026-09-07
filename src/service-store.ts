import { DatabaseSync } from "node:sqlite";

export interface ServiceInput { name: string; owner: string; targetId: string; intervalSeconds: number }
export interface Service extends ServiceInput { id: string; environmentId: string; enabled: boolean; version: number; createdAt: number }
export class ServiceConflict extends Error {}
export class ServiceLimit extends Error {}

export class ServiceStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, environment_id TEXT NOT NULL, name TEXT NOT NULL, owner TEXT NOT NULL, target_id TEXT NOT NULL, interval_seconds INTEGER NOT NULL, enabled INTEGER NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE(environment_id, target_id));
      CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, request_id TEXT NOT NULL, created_at INTEGER NOT NULL);`);
  }
  private map(row: Record<string, unknown>): Service {
    return { id: String(row.id), environmentId: String(row.environment_id), name: String(row.name), owner: String(row.owner), targetId: String(row.target_id), intervalSeconds: Number(row.interval_seconds), enabled: Boolean(row.enabled), version: Number(row.version), createdAt: Number(row.created_at) };
  }
  get(id: string) { const row = this.db.prepare("SELECT * FROM services WHERE id = ?").get(id); return row ? this.map(row) : null; }
  list(environmentId: string) { return this.db.prepare("SELECT * FROM services WHERE environment_id = ? ORDER BY created_at, id LIMIT 100").all(environmentId).map((row) => this.map(row)); }
  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private audit(actor: string, action: string, requestId: string) {
    this.db.prepare("INSERT INTO audit_events (actor, action, request_id, created_at) VALUES (?, ?, ?, ?)").run(actor, action, requestId, Date.now());
  }
  create(id: string, environmentId: string, input: ServiceInput, actor: string, requestId: string) {
    return this.transaction(() => {
      const existing = this.get(id);
      if (existing) {
        if (existing.environmentId === environmentId && existing.name === input.name && existing.owner === input.owner && existing.targetId === input.targetId && existing.intervalSeconds === input.intervalSeconds && existing.version === 1) return existing;
        throw new ServiceConflict();
      }
      if (this.list(environmentId).length >= 100) throw new ServiceLimit();
      if (this.db.prepare("SELECT id FROM services WHERE environment_id = ? AND target_id = ?").get(environmentId, input.targetId)) throw new ServiceConflict();
      this.db.prepare("INSERT INTO services VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)").run(id, environmentId, input.name, input.owner, input.targetId, input.intervalSeconds, Date.now());
      this.audit(actor, `service.created:${id}`, requestId);
      return this.get(id)!;
    });
  }
  update(id: string, version: number, input: ServiceInput & { enabled: boolean }, actor: string, requestId: string) {
    return this.transaction(() => {
      if (this.db.prepare("SELECT id FROM services WHERE environment_id = (SELECT environment_id FROM services WHERE id = ?) AND target_id = ? AND id != ?").get(id, input.targetId, id)) throw new ServiceConflict();
      const changed = this.db.prepare("UPDATE services SET name = ?, owner = ?, target_id = ?, interval_seconds = ?, enabled = ?, version = version + 1 WHERE id = ? AND version = ?").run(input.name, input.owner, input.targetId, input.intervalSeconds, Number(input.enabled), id, version);
      if (!changed.changes) throw new ServiceConflict();
      this.audit(actor, `service.updated:${id}:v${version + 1}:${input.enabled ? "enabled" : "disabled"}`, requestId);
      return this.get(id)!;
    });
  }
  close() { this.db.close(); }
}
