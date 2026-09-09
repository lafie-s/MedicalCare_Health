import type { DatabaseSync } from "node:sqlite";
import type { ProbeRecord } from "./service-store.js";
import type { ProbeResult } from "./probe.js";
export const diagnosticCodes = ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID"] as const;
export function safeDiagnostic(code: unknown) { return typeof code === "string" && (diagnosticCodes as readonly string[]).includes(code) ? code : "CONNECTION_FAILED"; }
export class FailureLogStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS failure_logs (probe_id TEXT PRIMARY KEY, service_id TEXT NOT NULL, started_at INTEGER NOT NULL, outcome TEXT NOT NULL, http_status INTEGER, latency_ms REAL, diagnostic_code TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS failure_log_time ON failure_logs(service_id, started_at DESC);`);
  }
  record(sample: ProbeRecord, result: ProbeResult) {
    if (sample.outcome === "success" || sample.outcome === "running") return;
    const code = sample.outcome === "connection_error" ? safeDiagnostic(result.diagnosticCode) : sample.outcome === "timeout" ? "PROBE_TIMEOUT" : sample.outcome === "interrupted" ? "PROBE_INTERRUPTED" : `HTTP_${sample.httpStatus}`;
    this.db.prepare("INSERT OR IGNORE INTO failure_logs VALUES (?,?,?,?,?,?,?)").run(sample.id, sample.serviceId, sample.startedAt, sample.outcome, sample.httpStatus, sample.latencyMs, code);
    this.db.prepare("DELETE FROM failure_logs WHERE service_id=? AND probe_id NOT IN (SELECT probe_id FROM failure_logs WHERE service_id=? ORDER BY started_at DESC,probe_id DESC LIMIT 10000)").run(sample.serviceId, sample.serviceId);
  }
  prune(now = Date.now()) { this.db.prepare("DELETE FROM failure_logs WHERE started_at<?").run(now - 30 * 86_400_000); }
  list(serviceId: string, page: number, now = Date.now()) {
    const cutoff = now - 30 * 86_400_000;
    const total = Number(this.db.prepare("SELECT COUNT(*) n FROM failure_logs WHERE service_id=? AND started_at>=? AND started_at<=?").get(serviceId, cutoff, now)!.n);
    const current = Math.min(page, Math.max(1, Math.ceil(total / 20)));
    const items = this.db.prepare("SELECT * FROM failure_logs WHERE service_id=? AND started_at>=? AND started_at<=? ORDER BY started_at DESC,probe_id DESC LIMIT 20 OFFSET ?").all(serviceId, cutoff, now, (current - 1) * 20).map((r) => ({ id: String(r.probe_id), startedAt: Number(r.started_at), outcome: String(r.outcome), httpStatus: r.http_status === null ? null : Number(r.http_status), latencyMs: r.latency_ms === null ? null : Number(r.latency_ms), diagnosticCode: String(r.diagnostic_code) }));
    return { items, total, page: current, pageSize: 20, asOf: now, retentionDays: 30, limit: 10000 };
  }
}
