import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ProbeRecord, Service } from "./service-store.js";
export interface AlertRuleInput { failureCount: number; recoveryCount: number; severity: "warning" | "critical"; enabled: boolean }
export interface AlertRule extends AlertRuleInput { version: number; updatedAt: number }
export type AlertState = "firing" | "acknowledged" | "recovered" | "closed" | "terminated";
export interface AlertEvent { id: string; serviceId: string; state: AlertState; severity: string; openedAt: number; lastSeen: number; recoveredAt: number | null; acknowledgedBy: string | null; endedAt: number | null; reason: string | null; rule: AlertRuleInput & { version: number; serviceVersion: number } }
export class AlertConflict extends Error {}

export class AlertStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS alert_rules (service_id TEXT PRIMARY KEY, definition TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0, successes INTEGER NOT NULL DEFAULT 0, last_sample INTEGER NOT NULL DEFAULT 0, fingerprint TEXT);
      CREATE TABLE IF NOT EXISTS alert_events (id TEXT PRIMARY KEY, service_id TEXT NOT NULL, state TEXT NOT NULL, severity TEXT NOT NULL, opened_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, recovered_at INTEGER, acknowledged_by TEXT, ended_at INTEGER, reason TEXT, rule_snapshot TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_firing_alert ON alert_events(service_id) WHERE state IN ('firing', 'acknowledged');
      CREATE INDEX IF NOT EXISTS service_alert_history ON alert_events(service_id, opened_at DESC);`);
  }
  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE"); try { const result = action(); this.db.exec("COMMIT"); return result; } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private audit(actor: string, action: string, requestId: string) { this.db.prepare("INSERT INTO audit_events(actor, action, request_id, created_at) VALUES (?, ?, ?, ?)").run(actor, action, requestId, Date.now()); }
  rule(serviceId: string): AlertRule | null {
    const row = this.db.prepare("SELECT * FROM alert_rules WHERE service_id = ?").get(serviceId);
    return row ? { ...JSON.parse(String(row.definition)) as AlertRuleInput, version: Number(row.version), updatedAt: Number(row.updated_at) } : null;
  }
  saveRule(serviceId: string, input: AlertRuleInput, version: number, actor: string, requestId: string, now = Date.now()) {
    return this.transaction(() => {
      if ((this.rule(serviceId)?.version ?? 0) !== version) throw new AlertConflict();
      this.invalidate(serviceId, input.enabled ? "rule_changed" : "rule_disabled", requestId, now);
      this.db.prepare(`INSERT INTO alert_rules(service_id, definition, version, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(service_id) DO UPDATE SET definition=excluded.definition, version=excluded.version, updated_at=excluded.updated_at, failures=0, successes=0, last_sample=0, fingerprint=NULL`).run(serviceId, JSON.stringify(input), version + 1, now);
      this.audit(actor, `alert.rule_saved:${serviceId}:v${version + 1}`, requestId);
      return this.rule(serviceId)!;
    });
  }
  private map(row: Record<string, unknown>): AlertEvent {
    return { id: String(row.id), serviceId: String(row.service_id), state: row.state as AlertState, severity: String(row.severity), openedAt: Number(row.opened_at), lastSeen: Number(row.last_seen), recoveredAt: row.recovered_at === null ? null : Number(row.recovered_at), acknowledgedBy: row.acknowledged_by === null ? null : String(row.acknowledged_by), endedAt: row.ended_at === null ? null : Number(row.ended_at), reason: row.reason === null ? null : String(row.reason), rule: JSON.parse(String(row.rule_snapshot)) as AlertEvent["rule"] };
  }
  get(id: string) { const row = this.db.prepare("SELECT * FROM alert_events WHERE id = ?").get(id); return row ? this.map(row) : null; }
  list(serviceId: string, page: number) {
    const total = Number(this.db.prepare("SELECT COUNT(*) AS total FROM alert_events WHERE service_id = ?").get(serviceId)!.total);
    return { total, page, pageSize: 20, items: this.db.prepare("SELECT * FROM alert_events WHERE service_id = ? ORDER BY opened_at DESC, id DESC LIMIT 20 OFFSET ?").all(serviceId, (page - 1) * 20).map((row) => this.map(row)) };
  }
  // Called inside the enclosing service/sample transaction, so invalidation cannot be lost.
  invalidate(serviceId: string, reason: string, requestId: string, now = Date.now()) {
    const active = this.db.prepare("SELECT id FROM alert_events WHERE service_id = ? AND state IN ('firing', 'acknowledged')").get(serviceId);
    if (active) {
      this.db.prepare("UPDATE alert_events SET state='terminated', ended_at=?, reason=? WHERE id=?").run(now, reason, String(active.id));
      this.audit("system:collector", `alert.terminated:${String(active.id)}:${reason}`, requestId);
    }
    this.db.prepare("UPDATE alert_rules SET failures=0, successes=0, last_sample=0, fingerprint=NULL WHERE service_id=?").run(serviceId);
  }
  reconcile(targets: Map<string, string>, now = Date.now()) {
    this.transaction(() => {
      for (const row of this.db.prepare("SELECT service_id, fingerprint FROM alert_rules WHERE fingerprint IS NOT NULL").all()) {
        const fingerprint = targets.get(String(row.service_id));
        if (fingerprint !== row.fingerprint) this.invalidate(String(row.service_id), fingerprint ? "target_changed" : "target_unavailable", "policy", now);
      }
    });
  }
  // Sample completion calls this within its own SQLite transaction.
  sample(service: Service, sample: ProbeRecord, now = Date.now()) {
    const row = this.db.prepare("SELECT * FROM alert_rules WHERE service_id = ?").get(service.id);
    if (!row || !service.enabled || sample.serviceVersion !== service.version || sample.outcome === "running") return;
    const rule = JSON.parse(String(row.definition)) as AlertRuleInput;
    if (!rule.enabled || sample.startedAt <= Number(row.updated_at) || sample.startedAt <= Number(row.last_sample)) return;
    if (row.fingerprint !== null && row.fingerprint !== sample.targetFingerprint) this.invalidate(service.id, "target_changed", sample.id, now);
    const continuous = row.fingerprint === sample.targetFingerprint && sample.startedAt - Number(row.last_sample) <= service.intervalSeconds * 2000 + 5000;
    const fresh = now - sample.startedAt <= service.intervalSeconds * 2000 + 5000;
    const failed = fresh && ["http_error", "timeout", "connection_error"].includes(sample.outcome);
    const success = fresh && sample.outcome === "success";
    const failures = failed ? (continuous ? Number(row.failures) : 0) + 1 : 0;
    const successes = success ? (continuous ? Number(row.successes) : 0) + 1 : 0;
    this.db.prepare("UPDATE alert_rules SET failures=?, successes=?, last_sample=?, fingerprint=? WHERE service_id=?").run(failures, successes, sample.startedAt, sample.targetFingerprint, service.id);
    const active = this.db.prepare("SELECT id FROM alert_events WHERE service_id=? AND state IN ('firing','acknowledged')").get(service.id);
    if (!active && failures >= rule.failureCount) {
      const id = randomUUID();
      this.db.prepare("INSERT INTO alert_events(id, service_id, state, severity, opened_at, last_seen, rule_snapshot) VALUES (?, ?, 'firing', ?, ?, ?, ?)").run(id, service.id, rule.severity, sample.startedAt, sample.startedAt, JSON.stringify({ ...rule, version: Number(row.version), serviceVersion: service.version }));
      this.audit("system:collector", `alert.fired:${id}`, sample.id);
    } else if (active && success && successes >= rule.recoveryCount) {
      this.db.prepare("UPDATE alert_events SET state='recovered', recovered_at=?, last_seen=? WHERE id=?").run(sample.startedAt, sample.startedAt, String(active.id));
      this.audit("system:collector", `alert.recovered:${String(active.id)}`, sample.id);
    } else if (active && fresh && (failed || success)) {
      this.db.prepare("UPDATE alert_events SET last_seen=? WHERE id=?").run(sample.startedAt, String(active.id));
    }
  }
  transition(id: string, action: "acknowledge" | "close", actor: string, requestId: string) {
    return this.transaction(() => {
      const event = this.get(id); if (!event) throw new AlertConflict();
      if (action === "acknowledge" && event.state === "acknowledged" || action === "close" && event.state === "closed") return event;
      if (action === "acknowledge" && event.state !== "firing" || action === "close" && event.state !== "recovered") throw new AlertConflict();
      if (action === "acknowledge") this.db.prepare("UPDATE alert_events SET state='acknowledged', acknowledged_by=? WHERE id=?").run(actor, id);
      else this.db.prepare("UPDATE alert_events SET state='closed', ended_at=? WHERE id=?").run(Date.now(), id);
      this.audit(actor, `alert.${action}:${id}`, requestId); return this.get(id)!;
    });
  }
}
