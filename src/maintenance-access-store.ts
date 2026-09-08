import type { DatabaseSync } from "node:sqlite";
import type { AccessInput } from "./maintenance-access.js";
export interface AccessPolicy extends AccessInput { version: number; updatedAt: number | null }
export class AccessConflict extends Error {}
export class MaintenanceAccessStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS maintenance_access (service_id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS maintenance_access_changes (id TEXT PRIMARY KEY, service_id TEXT NOT NULL, actor TEXT NOT NULL, input TEXT NOT NULL, before_data TEXT NOT NULL, after_data TEXT NOT NULL, created_at INTEGER NOT NULL);`);
  }
  get(serviceId: string): AccessPolicy {
    const row = this.db.prepare("SELECT data FROM maintenance_access WHERE service_id=?").get(serviceId);
    return row ? JSON.parse(String(row.data)) as AccessPolicy : { mode: "off", allowlist: [], reason: "", version: 0, updatedAt: null };
  }
  save(serviceId: string, input: AccessInput, version: number, id: string, actor: string, requestId: string) {
    const serialized = JSON.stringify({ ...input, version });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.db.prepare("SELECT * FROM maintenance_access_changes WHERE id=?").get(id);
      if (old) {
        if (old.service_id !== serviceId || old.actor !== actor || old.input !== serialized) throw new AccessConflict("重复请求内容不一致，请刷新后重试");
        const current = this.get(serviceId); this.db.exec("COMMIT"); return current;
      }
      const before = this.get(serviceId);
      if (before.version !== version) throw new AccessConflict("配置已被修改，请刷新后重新核对");
      const after = { ...input, version: version + 1, updatedAt: Date.now() };
      this.db.prepare("INSERT INTO maintenance_access_changes VALUES (?,?,?,?,?,?,?)").run(id, serviceId, actor, serialized, JSON.stringify(before), JSON.stringify(after), after.updatedAt);
      this.db.prepare("INSERT INTO maintenance_access VALUES (?,?) ON CONFLICT(service_id) DO UPDATE SET data=excluded.data").run(serviceId, JSON.stringify(after));
      this.db.prepare("INSERT INTO audit_events(actor,action,request_id,created_at) VALUES (?,?,?,?)").run(actor, `maintenance.access_saved:${serviceId}:v${after.version}`, requestId, after.updatedAt);
      this.db.exec("COMMIT"); return after;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
