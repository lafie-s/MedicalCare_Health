import type { Service, ServiceStore } from "./service-store.js";
export type TrendHours = 1 | 6 | 24;
export interface TrendBucket { start: number; end: number; samples: number; interrupted: number; latencySamples: number; averageLatencyMs: number | null; availabilityPercent: number | null }
export interface ProbeTrend { start: number; end: number; bucketSeconds: number; serviceVersion: number; lastSampleAt: number | null; points: TrendBucket[] }
export function probeTrend(store: ServiceStore, service: Service, fingerprint: string | undefined, hours: TrendHours, now = Date.now()): ProbeTrend {
  const bucketSeconds = hours === 1 ? 60 : hours === 6 ? 300 : 900;
  const start = now - hours * 3_600_000;
  const rows = fingerprint ? store.trendBuckets(service, fingerprint, start, now, bucketSeconds * 1000) : [];
  const points: TrendBucket[] = Array.from({ length: hours * 3600 / bucketSeconds }, (_, index) => ({ start: start + index * bucketSeconds * 1000, end: start + (index + 1) * bucketSeconds * 1000, samples: 0, interrupted: 0, latencySamples: 0, averageLatencyMs: null, availabilityPercent: null }));
  let lastSampleAt: number | null = null;
  for (const row of rows) {
    const point = points[Number(row.bucket)]; if (!point) continue;
    point.samples = Number(row.samples); point.interrupted = Number(row.interrupted); point.latencySamples = Number(row.latency_samples);
    point.averageLatencyMs = row.latency === null ? null : Math.round(Number(row.latency) * 100) / 100;
    point.availabilityPercent = point.samples ? Math.round(Number(row.successful) / point.samples * 10000) / 100 : null;
    if (row.latest !== null) lastSampleAt = Math.max(lastSampleAt ?? 0, Number(row.latest));
  }
  return { start, end: now, bucketSeconds, serviceVersion: service.version, lastSampleAt, points };
}
