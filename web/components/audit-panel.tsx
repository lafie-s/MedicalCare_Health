"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { Button, Notice } from "./ui";

const categories = { all: "全部操作", service: "服务配置", probe: "HTTP 探测", alert: "告警处理", maintenance: "维护窗口" };
const operations: Record<string, string> = { "service.created": "登记服务", "service.updated": "更新服务", "probe.started": "开始探测", "probe.finished": "完成探测", "alert.rule_saved": "保存告警规则", "alert.fired": "触发告警", "alert.recovered": "告警恢复", "alert.terminated": "终止告警", "alert.acknowledge": "确认告警", "alert.close": "关闭告警", "maintenance.created": "登记维护窗口", "maintenance.canceled": "取消维护窗口" };
type Query = { category: keyof typeof categories; days: number; to: number; page: number };
type Result = { items: { id: number; actor: string; operation: string; createdAt: number; serviceId: string; serviceName: string }[]; total: number; page: number; pageSize: number; from: number; to: number; asOf: number };
const time = (value: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(value);
function restore(): Query {
  const params = new URLSearchParams(location.search); const category = params.get("auditCategory") ?? "all"; const days = Number(params.get("auditDays") ?? 1); const to = Number(params.get("auditTo")); const page = Number(params.get("auditPage") ?? 1);
  return { category: Object.hasOwn(categories, category) ? category as Query["category"] : "all", days: [1, 7, 31].includes(days) ? days : 1, to: Number.isSafeInteger(to) && to > 31 * 86_400_000 && to <= Date.now() ? to : Date.now(), page: Number.isInteger(page) && page >= 1 && page <= 100000 ? page : 1 };
}
function persist(query: Query) { const url = new URL(location.href); for (const [key, value] of Object.entries({ auditCategory: query.category, auditDays: query.days, auditTo: query.to, auditPage: query.page })) url.searchParams.set(key, String(value)); history.replaceState(null, "", url); }
export function AuditPanel({ environmentId, onUnauthorized }: { environmentId: string; onUnauthorized: () => void }) {
  const [query, setQuery] = useState<Query | null>(null); const [data, setData] = useState<Result | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const auth = useRef(onUnauthorized); auth.current = onUnauthorized;
  useEffect(() => { const read = () => { setData(null); setQuery(restore()); }; read(); window.addEventListener("popstate", read); return () => window.removeEventListener("popstate", read); }, []);
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController(); setLoading(true); setError(""); setData(null); persist(query);
    void api<Result>(`/audit?environmentId=${encodeURIComponent(environmentId)}&category=${query.category}&from=${query.to - query.days * 86_400_000}&to=${query.to}&page=${query.page}`, { signal: controller.signal }).then((result) => { if (controller.signal.aborted) return; setData(result); persist({ ...query, page: result.page }); }).catch((err) => { if (controller.signal.aborted) return; if (err instanceof ApiError && [401, 403].includes(err.status)) auth.current(); else setError(err instanceof Error ? err.message : "审计记录读取失败"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, environmentId]);
  return <section className="alert-center" aria-labelledby="audit-title"><div className="panel-heading"><h2 id="audit-title">操作审计</h2><Button busy={loading} onClick={() => query && setQuery({ ...query, page: 1, to: Date.now() })}>刷新审计</Button></div><div className="alert-center-content">
    <p className="muted">仅管理员可查当前环境的服务操作。操作人显示账号 ID；登录记录暂不在此列出。</p><div className="audit-filters"><div><label htmlFor="audit-category">操作类型</label><select id="audit-category" value={query?.category ?? "all"} onChange={(event) => query && setQuery({ ...query, category: event.target.value as Query["category"], page: 1 })}>{Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div><label htmlFor="audit-days">审计时间范围</label><select id="audit-days" value={query?.days ?? 1} onChange={(event) => query && setQuery({ ...query, days: Number(event.target.value), page: 1, to: Date.now() })}><option value={1}>最近 24 小时</option><option value={7}>最近 7 天</option><option value={31}>最近 31 天</option></select></div></div>
    <div aria-busy={loading}>{loading ? <Notice>正在读取审计记录…</Notice> : error ? <Notice error>{error}，请点击“刷新审计”重试。</Notice> : data && <><p className="trend-caption">北京时间 {time(data.from)} 至 {time(data.to)}（不含结束时刻）。查询于 {time(data.asOf)}，手动刷新获取最新记录。</p>{!data.items.length ? <Notice>当前筛选下没有审计记录。</Notice> : <ul className="alert-events">{data.items.map((item) => <li key={item.id}><div className="service-row"><strong>{operations[item.operation] ?? item.operation}</strong><span>{time(item.createdAt)}</span></div><p>服务：{item.serviceName}（当前名称）</p><p>操作人：{item.actor} · 记录 #{item.id}</p><a className="overview-alert-link" href={`#service-${item.serviceId}`}>定位服务</a></li>)}</ul>}<div className="inline-actions"><Button disabled={data.page <= 1} onClick={() => setQuery({ ...query!, page: data.page - 1 })}>上一页审计</Button><span>第 {data.page} 页 · 共 {data.total} 条</span><Button disabled={data.page * data.pageSize >= data.total} onClick={() => setQuery({ ...query!, page: data.page + 1 })}>下一页审计</Button></div></>}</div>
  </div></section>;
}
