"use client";
import { currentHealth, healthReasons, summarizeHealth } from "../../src/health-summary";
import type { Service } from "./service-panel";

export function HealthOverview({ items, now, asOf }: { items: Service[]; now: number; asOf: number }) {
  const summary = summarizeHealth(items, now);
  const attention = items.map((item) => ({ item, ...currentHealth(item, now) }))
    .filter(({ status }) => status === "unhealthy" || status === "unknown")
    .sort((a, b) => Number(b.status === "unhealthy") - Number(a.status === "unhealthy") || a.item.name.localeCompare(b.item.name, "zh-CN"));
  const labels = { healthy: "探测正常", unhealthy: "探测异常", unknown: "状态未知", disabled: "采集停用" };
  return <section className="health-overview" aria-labelledby="overview-title">
    <div className="overview-heading"><div><h2 id="overview-title">HTTP 健康概览</h2><p>当前环境 · {summary.total} 个已登记服务</p></div><strong className={summary.status === "unhealthy" ? "probe-error" : ""}>{summary.status === "healthy" ? "已登记服务探测正常" : summary.status === "unhealthy" ? "存在探测异常" : "监测覆盖尚不完整"}</strong></div>
    <dl className="health-counts">{(Object.keys(labels) as (keyof typeof labels)[]).map((key) => <div key={key}><dt>{labels[key]}</dt><dd className={key === "unhealthy" && summary.counts[key] ? "probe-error" : ""}>{summary.counts[key]}</dd></div>)}</dl>
    <p className="overview-meta">数据查询时间 · 北京时间 {new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(asOf)} · 每 30 秒刷新 · {summary.stale} 个服务数据过期</p>
    {!items.length ? <p>尚未登记服务，无法判断环境健康状态。</p> : <><h3>需要关注</h3>{attention.length ? <ul className="attention-list">{attention.map(({ item, reason }) => <li key={item.id}><a href={`#service-${item.id}`}>{item.name}</a><span>{healthReasons[reason] ?? "状态未知"} · {item.owner}</span></li>)}</ul> : <p>{summary.counts.disabled ? "当前没有已知探测异常，停用服务未纳入监测。" : "当前没有异常或未知的已登记服务。"}</p>}</>}
    <p className="overview-meta">仅反映 HTTP 探测；停用不等于维护中，未登记服务及资源、业务指标不在本概览范围。</p>
    <a className="overview-alert-link" href="#environment-alerts">查看当前环境告警</a>
  </section>;
}
