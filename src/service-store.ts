import { DatabaseSync } from "node:sqlite";
import type { ProbeResult, ProbeOutcome } from "./probe.js";
import { AlertStore } from "./alert-store.js";
import { MaintenanceStore } from "./maintenance-store.js";

export interface ServiceInput { name: string; owner: string; targetId: string; intervalSeconds: number }
export interface Service extends ServiceInput { id: string; environmentId: string; enabled: boolean; version: number; createdAt: number }
export class ServiceConflict extends Error {}
export class ServiceLimit extends Error {}
export interface ProbeRecord { id: string; serviceId: string; serviceVersion: number; targetFingerprint: string; startedAt: number; finishedAt: number | null; outcome: ProbeOutcome | "running"; httpStatus: number | null; latencyMs: number | null; actor: string }

export class ServiceStore {
  private readonly db: DatabaseSync;
  readonly alerts: AlertStore;
  readonly maintenance: MaintenanceStore;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, environment_id TEXT NOT NULL, name TEXT NOT NULL, owner TEXT NOT NULL, target_id TEXT NOT NULL, interval_seconds INTEGER NOT NULL, enabled INTEGER NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE(environment_id, target_id));
      CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, request_id TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS probe_runs (id TEXT PRIMARY KEY, service_id TEXT NOT NULL, service_version INTEGER NOT NULL, target_fingerprint TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, outcome TEXT NOT NULL, http_status INTEGER, latency_ms REAL, actor TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_probe ON probe_runs(service_id) WHERE outcome = 'running';
      CREATE INDEX IF NOT EXISTS probe_history ON probe_runs(service_id, started_at DESC);`);
    this.alerts = new AlertStore(this.db);
    this.maintenance = new MaintenanceStore(this.db);
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
      this.alerts.invalidate(id, input.enabled ? "service_changed" : "service_disabled", requestId);
      this.audit(actor, `service.updated:${id}:v${version + 1}:${input.enabled ? "enabled" : "disabled"}`, requestId);
      return this.get(id)!;
    });
  }
  close() { this.db.close(); }
  private mapProbe(row: Record<string, unknown>): ProbeRecord {
    return { id: String(row.id), serviceId: String(row.service_id), serviceVersion: Number(row.service_version), targetFingerprint: String(row.target_fingerprint), startedAt: Number(row.started_at), finishedAt: row.finished_at === null ? null : Number(row.finished_at), outcome: row.outcome as ProbeRecord["outcome"], httpStatus: row.http_status === null ? null : Number(row.http_status), latencyMs: row.latency_ms === null ? null : Number(row.latency_ms), actor: String(row.actor) };
  }
  getProbe(id: string) { const row = this.db.prepare("SELECT * FROM probe_runs WHERE id = ?").get(id); return row ? this.mapProbe(row) : null; }
  latestProbe(serviceId: string) { const row = this.db.prepare("SELECT * FROM probe_runs WHERE service_id = ? AND outcome != 'running' ORDER BY started_at DESC, id DESC LIMIT 1").get(serviceId); return row ? this.mapProbe(row) : null; }
  lastProbeStart(serviceId: string) { return Number(this.db.prepare("SELECT MAX(started_at) AS started FROM probe_runs WHERE service_id = ?").get(serviceId)?.started ?? 0); }
  probeDue(service: Service, now = Date.now()) { return now - this.lastProbeStart(service.id) >= service.intervalSeconds * 1000; }
  claimProbe(service: Service, id: string, fingerprint: string, actor: string, requestId: string, now = Date.now()) {
    return this.transaction(() => {
      const expired = this.db.prepare("SELECT id FROM probe_runs WHERE service_id = ? AND outcome = 'running' AND started_at <= ?").get(service.id, now - 10_000);
      if (expired) {
        this.db.prepare("UPDATE probe_runs SET outcome = 'interrupted', finished_at = ? WHERE id = ?").run(now, String(expired.id));
        this.audit("system:collector", `probe.finished:${String(expired.id)}:interrupted`, requestId);
        this.alerts.sample(service, this.getProbe(String(expired.id))!, now);
      }
      if (!this.probeDue(service, now) || this.db.prepare("SELECT id FROM probe_runs WHERE service_id = ? AND outcome = 'running'").get(service.id)) return false;
      const inserted = this.db.prepare("INSERT OR IGNORE INTO probe_runs VALUES (?, ?, ?, ?, ?, NULL, 'running', NULL, NULL, ?)").run(id, service.id, service.version, fingerprint, now, actor);
      if (!inserted.changes) return false;
      this.audit(actor, `probe.started:${service.id}:${id}`, requestId);
      return true;
    });
  }
  finishProbe(id: string, result: ProbeResult, now = Date.now()) {
    this.transaction(() => {
      const changed = this.db.prepare("UPDATE probe_runs SET outcome = ?, http_status = ?, latency_ms = ?, finished_at = ? WHERE id = ? AND outcome = 'running'").run(result.outcome, result.httpStatus, result.latencyMs, now, id);
      if (changed.changes) {
        this.audit("system:collector", `probe.finished:${id}:${result.outcome}`, id);
        const sample = this.getProbe(id)!; const service = this.get(sample.serviceId);
        if (service) this.alerts.sample(service, sample, now);
      }
    });
  }
  probeStats(service: Service, fingerprint: string, now: number) {
    const row = this.db.prepare("SELECT COUNT(*) AS samples, COALESCE(SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END), 0) AS successful FROM probe_runs WHERE service_id = ? AND service_version = ? AND target_fingerprint = ? AND started_at > ? AND started_at <= ? AND outcome IN ('success', 'http_error', 'timeout', 'connection_error')").get(service.id, service.version, fingerprint, now - 300_000, now)!;
    return { samples: Number(row.samples), successful: Number(row.successful) };
  }
  pruneProbes(now = Date.now()) { this.db.prepare("DELETE FROM probe_runs WHERE outcome != 'running' AND started_at < ?").run(now - 86_400_000); }
  trendBuckets(service: Service, fingerprint: string, start: number, end: number, bucketMs: number) {
    // Integer millisecond timestamps: each bucket is (start, end], matching overview windows.
    return this.db.prepare(`SELECT CAST((started_at - ? - 1) / ? AS INTEGER) AS bucket,
      SUM(CASE WHEN outcome != 'interrupted' THEN 1 ELSE 0 END) AS samples,
      SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS successful,
      SUM(CASE WHEN outcome = 'interrupted' THEN 1 ELSE 0 END) AS interrupted,
      COUNT(CASE WHEN outcome IN ('success', 'http_error') THEN latency_ms END) AS latency_samples,
      AVG(CASE WHEN outcome IN ('success', 'http_error') THEN latency_ms END) AS latency,
      MAX(CASE WHEN outcome != 'interrupted' THEN started_at END) AS latest
      FROM probe_runs WHERE service_id = ? AND service_version = ? AND target_fingerprint = ?
      AND started_at > ? AND started_at <= ? AND outcome IN ('success', 'http_error', 'timeout', 'connection_error', 'interrupted')
      GROUP BY bucket ORDER BY bucket`).all(start, bucketMs, service.id, service.version, fingerprint, start, end);
  }
}
