import type { DatabaseSync } from "node:sqlite";
export type ReleaseTask = { id: string; serviceId: string; from: string; to: string; action: "update" | "rollback"; reason: string; backupReference: string; actor: string; status: "running" | "succeeded" | "failed" | "unknown"; message: string; createdAt: number; finishedAt: number | null };
export class ReleaseConflict extends Error {}
export class ReleaseStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec("CREATE TABLE IF NOT EXISTS release_tasks(id TEXT PRIMARY KEY,service_id TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL); CREATE UNIQUE INDEX IF NOT EXISTS release_active ON release_tasks(service_id) WHERE status IN ('running','unknown');");
    for (const row of db.prepare("SELECT data FROM release_tasks WHERE status='running'").all()) {
      const task = JSON.parse(String(row.data)) as ReleaseTask;
      this.finish(task.id, "unknown", "进程曾中断，须核对实际镜像和健康状态后解除锁定");
    }
  }
  get(id: string): ReleaseTask | null { const row = this.db.prepare("SELECT data FROM release_tasks WHERE id=?").get(id); return row ? JSON.parse(String(row.data)) as ReleaseTask : null; }
  list(serviceId: string): ReleaseTask[] { return this.db.prepare("SELECT data FROM release_tasks WHERE service_id=? ORDER BY rowid DESC LIMIT 20").all(serviceId).map((row) => JSON.parse(String(row.data)) as ReleaseTask); }
  active(serviceId: string) { const row = this.db.prepare("SELECT data FROM release_tasks WHERE service_id=? AND status IN ('running','unknown')").get(serviceId); return row ? JSON.parse(String(row.data)) as ReleaseTask : null; }
  previous(serviceId: string) { const row = this.db.prepare("SELECT data FROM release_tasks WHERE service_id=? AND status='succeeded' ORDER BY rowid DESC LIMIT 1").get(serviceId); return row ? (JSON.parse(String(row.data)) as ReleaseTask).from : null; }
  private transaction<T>(action: () => T): T { this.db.exec("BEGIN IMMEDIATE"); try { const result = action(); this.db.exec("COMMIT"); return result; } catch (error) { this.db.exec("ROLLBACK"); throw error; } }
  create(task: ReleaseTask) {
    return this.transaction(() => {
      if (this.get(task.id) || this.active(task.serviceId)) throw new ReleaseConflict("已有更新任务或请求标识冲突");
      this.db.prepare("INSERT INTO release_tasks VALUES (?,?,?,?)").run(task.id, task.serviceId, task.status, JSON.stringify(task));
      this.db.prepare("INSERT INTO audit_events(actor,action,request_id,created_at) VALUES (?,?,?,?)").run(task.actor, `release.started:${task.serviceId}`, task.id, Date.now());
      return task;
    });
  }
  finish(id: string, status: ReleaseTask["status"], message: string, actor = "system:release") {
    return this.transaction(() => {
      const task = this.get(id); if (!task || !["running", "unknown"].includes(task.status)) throw new ReleaseConflict("任务不存在或已结束");
      const updated = { ...task, status, message, finishedAt: status === "unknown" ? null : Date.now() };
      this.db.prepare("UPDATE release_tasks SET status=?,data=? WHERE id=?").run(status, JSON.stringify(updated), id);
      this.db.prepare("INSERT INTO audit_events(actor,action,request_id,created_at) VALUES (?,?,?,?)").run(actor, `release.${status}:${task.serviceId}`, id, Date.now());
      return updated;
    });
  }
}
