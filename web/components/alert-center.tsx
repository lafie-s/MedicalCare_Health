"use client";
import { useEffect, useRef, useState } from "react";
import type { AlertEvent, AlertFilter } from "../../src/alert-store";
import { api, ApiError } from "./api";
import { Button, Notice } from "./ui";
const filters: Record<AlertFilter, string> = { active: "活动告警", all: "全部事件", firing: "待确认", acknowledged: "已确认，尚未恢复", recovered: "已恢复", closed: "已关闭", terminated: "已终止" };
type Result = { counts: Record<string, number>; active: number; criticalActive: number; total: number; page: number; pageSize: number; asOf: number; items: (AlertEvent & { serviceName: string; owner: string })[] };
function queryState() {
  const params = new URLSearchParams(location.search); const raw = params.get("alertState") ?? "active"; const page = Number(params.get("alertPage") ?? 1);
  return { filter: (Object.hasOwn(filters, raw) ? raw : "active") as AlertFilter, page: Number.isInteger(page) && page > 0 && page <= 100000 ? page : 1 };
}
function persist(filter: AlertFilter, page: number) {
  const url = new URL(location.href); url.searchParams.set("alertState", filter); url.searchParams.set("alertPage", String(page)); history.replaceState(null, "", url);
}
export function AlertCenter({ environmentId, revision, paused, onOpen, onUnauthorized }: { environmentId: string; revision: number; paused: boolean; onOpen: (id: string) => void; onUnauthorized: () => void }) {
  const [query, setQuery] = useState<{ filter: AlertFilter; page: number } | null>(null);
  const [refresh, setRefresh] = useState(0); const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const auth = useRef(onUnauthorized); auth.current = onUnauthorized;
  const returning = useRef(false);
  useEffect(() => { const restore = () => { setData(null); setQuery(queryState()); }; restore(); window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore); }, []);
  useEffect(() => {
    if (paused) { returning.current = true; return; }
    if (!query) return;
    const controller = new AbortController(); setLoading(true); setError("");
    void api<Result>(`/alerts?environmentId=${encodeURIComponent(environmentId)}&state=${query.filter}&page=${query.page}`, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return; setData(result); persist(query.filter, result.page);
      if (result.page !== query.page) setQuery({ ...query, page: result.page });
    }).catch((err) => { if (controller.signal.aborted) return; setData(null); if (err instanceof ApiError && [401, 403].includes(err.status)) auth.current(); else setError(err instanceof Error ? err.message : "告警中心加载失败"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [environmentId, query, revision, refresh, paused]);
  useEffect(() => {
    if (returning.current && !paused) {
      returning.current = false;
      if (document.activeElement === document.body) document.getElementById("environment-alerts")?.focus();
    }
  }, [data]);
  useEffect(() => { if (paused) return; const timer = setInterval(() => { if (document.visibilityState === "visible") setRefresh((value) => value + 1); }, 30_000); return () => clearInterval(timer); }, [paused]);
  function select(filter: AlertFilter, page: number) { setData(null); persist(filter, page); setQuery({ filter, page }); }
  return <section id="environment-alerts" tabIndex={-1} className="alert-center" aria-labelledby="alert-center-title"><div className="panel-heading"><h2 id="alert-center-title">环境告警中心</h2><Button busy={loading} onClick={() => setRefresh((value) => value + 1)}>刷新事件</Button></div>
    <div className="alert-center-content"><label htmlFor="alert-filter">事件状态</label><select id="alert-filter" value={query?.filter ?? "active"} onChange={(event) => select(event.target.value as AlertFilter, 1)}>{Object.entries(filters).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <div className="alert-center-results" aria-busy={loading}>{loading && !data ? <Notice>正在读取环境告警…</Notice> : error ? <Notice error>{error}</Notice> : data && <>
        <p className="alert-center-summary">活动 {data.active} · 其中严重 {data.criticalActive} · 待确认 {data.counts.firing}</p><p className="trend-caption">汇总覆盖当前环境全部事件，不随筛选变化。查询时间 · 北京时间 {new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(data.asOf)} · 每 30 秒刷新。活动告警不等同于当前探测状态，过期与恢复请结合服务明细。</p>
        {!data.items.length ? <Notice>当前筛选下没有告警事件。</Notice> : <ul className="alert-events">{data.items.map((event) => <li key={event.id}><div className="service-row"><strong>{event.serviceName}</strong><span>{event.severity === "critical" ? "严重" : "警告"} · {filters[event.state]}</span></div><p>负责人：{event.owner} · 触发 {new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(event.openedAt)}</p><div className="inline-actions"><a className="overview-alert-link" href={`#service-${event.serviceId}`}>定位服务</a><Button onClick={() => onOpen(event.serviceId)}>打开服务告警 {event.serviceName}</Button></div></li>)}</ul>}
        <div className="inline-actions"><Button disabled={data.page <= 1} onClick={() => select(query!.filter, data.page - 1)}>上一页事件</Button><span>第 {data.page} 页 · 共 {data.total} 条</span><Button disabled={data.page * data.pageSize >= data.total} onClick={() => select(query!.filter, data.page + 1)}>下一页事件</Button></div>
      </>}</div>
    </div></section>;
}
