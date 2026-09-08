import type { DatabaseSync } from "node:sqlite";

export interface AuditQuery { environmentId: string; from: number; to: number; page: number; category: "all" | "service" | "probe" | "alert" | "maintenance" | "release" }
// Only known action formats with a resolvable resource belong to an environment.
const scoped = `WITH parsed AS (
  SELECT id, actor, created_at, substr(action,1,instr(action,':')-1) AS operation,
    substr(action,instr(action,':')+1) AS details FROM audit_events WHERE created_at>=? AND created_at<?
), resources AS (
  SELECT *, CASE WHEN instr(details,':')=0 THEN details ELSE substr(details,1,instr(details,':')-1) END AS resource_id FROM parsed
), scoped AS (
  SELECT a.id,a.actor,a.created_at,a.operation,s.id AS service_id,s.name AS service_name
  FROM resources a JOIN services s ON s.id = CASE
    WHEN a.operation IN ('maintenance.access_saved','service.created','service.updated','probe.started','alert.rule_saved','release.started','release.succeeded','release.failed','release.unknown') THEN a.resource_id
    WHEN a.operation='probe.finished' THEN (SELECT service_id FROM probe_runs WHERE id=a.resource_id)
    WHEN a.operation IN ('alert.fired','alert.recovered','alert.terminated','alert.acknowledge','alert.close') THEN (SELECT service_id FROM alert_events WHERE id=a.resource_id)
    WHEN a.operation IN ('maintenance.created','maintenance.canceled') THEN (SELECT service_id FROM maintenance_windows WHERE id=a.resource_id)
    ELSE NULL END
  WHERE s.environment_id=? AND (?='all' OR substr(a.operation,1,instr(a.operation,'.')-1)=?)
)`;

export class AuditStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec("CREATE INDEX IF NOT EXISTS audit_time ON audit_events(created_at DESC,id DESC)");
  }
  query(input: AuditQuery) {
    const params = [input.from, input.to, input.environmentId, input.category, input.category];
    this.db.exec("BEGIN");
    try {
      const total = Number(this.db.prepare(`${scoped} SELECT COUNT(*) AS total FROM scoped`).get(...params)!.total);
      const page = Math.min(input.page, Math.max(1, Math.ceil(total / 20)));
      const items = this.db.prepare(`${scoped} SELECT * FROM scoped ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ?`).all(...params, (page - 1) * 20).map((row) => ({ id: Number(row.id), actor: String(row.actor), operation: String(row.operation), createdAt: Number(row.created_at), serviceId: String(row.service_id), serviceName: String(row.service_name) }));
      this.db.exec("COMMIT");
      return { items, total, page, pageSize: 20, from: input.from, to: input.to, asOf: Date.now() };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
