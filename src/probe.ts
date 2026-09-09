import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { performance } from "node:perf_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { AccessPolicy, ProbeTarget } from "./access-policy.js";
import type { ProbeRecord, Service, ServiceStore } from "./service-store.js";

import { safeDiagnostic } from "./failure-log-store.js";

export type ProbeOutcome = "success" | "http_error" | "connection_error" | "timeout" | "interrupted";
export interface ProbeResult { diagnosticCode?: string; outcome: ProbeOutcome; httpStatus: number | null; latencyMs: number | null }
export const targetFingerprint = (target: ProbeTarget) => createHash("sha256").update(`${target.url}\n${target.address}`).digest("hex");

// The target is deployment-approved. Pin its address without replacing the Host header or TLS name.
export function probeTarget(target: ProbeTarget, timeoutMs = 3000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const url = new URL(target.url);
    const start = performance.now();
    let settled = false;
    const finish = (result: ProbeResult) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method: "GET", agent: false,
      lookup: (_hostname, options, callback) => options.all ? callback(null, [{ address: target.address, family: isIP(target.address) }]) : callback(null, target.address, isIP(target.address)),
      headers: { "User-Agent": "MedicalCare-Health/0.1", Accept: "application/json", Connection: "close" },
    });
    const timer = setTimeout(() => { finish({ outcome: "timeout", httpStatus: null, latencyMs: null }); request.destroy(); }, timeoutMs);
    request.on("response", (response) => {
      const status = response.statusCode ?? 0;
      finish({ outcome: status >= 200 && status < 300 ? "success" : "http_error", httpStatus: status, latencyMs: Math.round((performance.now() - start) * 100) / 100 });
      // Do not follow redirects, retain response bodies, or download unbounded content.
      response.destroy();
    });
    request.on("error", (error: NodeJS.ErrnoException) => finish({ outcome: "connection_error", httpStatus: null, latencyMs: null, diagnosticCode: safeDiagnostic(error.code) }));
    request.end();
  });
}

export class ProbeRejected extends Error { constructor(public code: "BUSY" | "DISABLED" | "TARGET_REVOKED" | "CONFLICT") { super(code); } }

export class ProbeRunner {
  private active = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private currentTick: Promise<void> | undefined;
  constructor(private readonly store: ServiceStore, private readonly policy: () => Promise<AccessPolicy>, private readonly execute = probeTarget, private readonly onResult?: (sample: ProbeRecord) => void) {}
  async run(serviceId: string, id: string, actor: string, requestId: string) {
    const existing = this.store.getProbe(id);
    if (existing) {
      if (existing.serviceId !== serviceId || existing.actor !== actor) throw new ProbeRejected("CONFLICT");
      return existing;
    }
    const service = this.store.get(serviceId);
    if (!service?.enabled) throw new ProbeRejected("DISABLED");
    const policy = await this.policy();
    const target = (policy.probeTargets ?? []).find((item) => item.id === service.targetId && item.environmentId === service.environmentId);
    if (!target) throw new ProbeRejected("TARGET_REVOKED");
    if (this.stopped || this.active >= 4) throw new ProbeRejected("BUSY");
    const fingerprint = targetFingerprint(target);
    const claimed = this.store.claimProbe(service, id, fingerprint, actor, requestId);
    if (!claimed) throw new ProbeRejected("BUSY");
    this.active++;
    try {
      // Re-check service state after the policy read, immediately before network I/O.
      const current = this.store.get(serviceId);
      if (!current?.enabled || current.version !== service.version) {
        this.store.finishProbe(id, { outcome: "interrupted", httpStatus: null, latencyMs: null });
      } else {
        let result: ProbeResult;
        try { result = await this.execute(target); }
        catch { result = { outcome: "interrupted", httpStatus: null, latencyMs: null }; }
        this.store.finishProbe(id, result);
      }
      const completed = this.store.getProbe(id)!; this.onResult?.(completed); return completed;
    } finally { this.active--; }
  }
  async tick() {
    if (this.stopped) return;
    const policy = await this.policy();
    this.store.pruneProbes();
    const monitored = new Map<string, string>();
    for (const environment of policy.environments) for (const service of this.store.list(environment.id)) {
      const target = (policy.probeTargets ?? []).find((target) => target.id === service.targetId && target.environmentId === environment.id);
      if (service.enabled && target) monitored.set(service.id, targetFingerprint(target));
    }
    this.store.alerts.reconcile(monitored);
    const due = policy.environments.flatMap((environment) => this.store.list(environment.id))
      .filter((service) => service.enabled && (policy.probeTargets ?? []).some((target) => target.id === service.targetId && target.environmentId === service.environmentId) && this.store.probeDue(service))
      .sort((a, b) => this.store.lastProbeStart(a.id) - this.store.lastProbeStart(b.id)).slice(0, 4);
    const results = await Promise.allSettled(due.map((service) => this.run(service.id, randomUUID(), "system:collector", "scheduled")));
    if (results.some((result) => result.status === "rejected" && !(result.reason instanceof ProbeRejected))) throw new Error("Collector storage or configuration failed");
  }
  start(onError: () => void) {
    const schedule = () => {
      if (this.stopped) return;
      this.currentTick = this.tick().catch(onError).finally(() => { if (!this.stopped) { this.timer = setTimeout(schedule, 5000); this.timer.unref(); } });
    };
    schedule();
  }
  async stop() { this.stopped = true; clearTimeout(this.timer); await this.currentTick; }
}

export function serviceHealth(service: Service, target: ProbeTarget | undefined, store: ServiceStore, now = Date.now()) {
  const latest = store.latestProbe(service.id);
  const invalidated = !latest || latest.serviceVersion !== service.version || !target || latest.targetFingerprint !== targetFingerprint(target);
  const stale = Boolean(latest && now - latest.startedAt > service.intervalSeconds * 2000 + 5000);
  const reason = !service.enabled ? "disabled" : !target ? "target_revoked" : invalidated ? "no_current_sample" : stale ? "stale" : latest!.outcome === "interrupted" ? "interrupted" : latest!.outcome;
  const status = reason === "disabled" ? "disabled" : reason === "success" ? "healthy" : ["http_error", "connection_error", "timeout"].includes(reason) ? "unhealthy" : "unknown";
  const stats = target ? store.probeStats(service, targetFingerprint(target), now) : { samples: 0, successful: 0 };
  return { status, reason, latest, samplesInWindow: stats.samples, availabilityPercent: stats.samples ? Math.round(stats.successful / stats.samples * 10000) / 100 : null, windowSeconds: 300, stale, asOf: now };
}
