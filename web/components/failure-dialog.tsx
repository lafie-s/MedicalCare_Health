"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { Dialog } from "./dialog";
import { Button, Notice } from "./ui";
type Data = { items: { id: string; startedAt: number; outcome: string; httpStatus: number | null; latencyMs: number | null; diagnosticCode: string }[]; total: number; page: number; pageSize: number; asOf: number };
const labels: Record<string, string> = { http_error: "HTTP 异常", timeout: "探测超时", connection_error: "连接失败", interrupted: "采集中断" };
export function FailureDialog({ serviceId, serviceName, onClose, onUnauthorized }: { serviceId: string; serviceName: string; onClose: () => void; onUnauthorized: () => void }) {
  const [data, setData] = useState<Data | null>(null); const [page, setPage] = useState(1); const [revision, setRevision] = useState(0); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [now, setNow] = useState(Date.now());
  const auth = useRef(onUnauthorized); auth.current = onUnauthorized;
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError("");
    void api<Data>(`/services/${serviceId}/failure-logs?page=${page}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) setData(result); }).catch((err) => { if (controller.signal.aborted) return; setData(null); if (err instanceof ApiError && [401, 403].includes(err.status)) auth.current(); else setError(err instanceof Error ? err.message : "故障日志读取失败"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [serviceId, page, revision]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return <Dialog title={`${serviceName} · 故障日志`} onCancel={onClose}><p>记录异常探测的时间、HTTP 状态和连接错误码。保留最近 30 天，每服务最多 10,000 条；不保存响应正文、账号或患者信息。</p><div className="dialog-actions"><Button busy={loading} onClick={() => setRevision((v) => v + 1)}>刷新故障日志</Button></div>{error && <Notice error>{error}</Notice>}{loading ? <Notice>正在读取故障日志…</Notice> : data && <><p className="muted">读取时间：{new Date(data.asOf).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · 北京时间</p>{now - data.asOf > 30_000 && <Notice>日志快照已过期，请刷新查看最新记录。</Notice>}{data.items.length === 0 ? <Notice>最近 30 天暂无已保存故障日志。这不代表未接入的服务没有错误。</Notice> : <ul className="alert-events">{data.items.map((item) => <li key={item.id}><strong>{labels[item.outcome] ?? "异常"} · {item.diagnosticCode}</strong><p>{new Date(item.startedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · 北京时间</p><p>HTTP：{item.httpStatus ?? "未收到响应"} · 耗时：{item.latencyMs === null ? "无有效数据" : `${item.latencyMs} ms`}</p></li>)}</ul>}<div className="inline-actions"><Button disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>上一页故障</Button><span>第 {data.page} 页 · 共 {data.total} 条</span><Button disabled={data.page * data.pageSize >= data.total} onClick={() => setPage(data.page + 1)}>下一页故障</Button></div></>}<div className="dialog-actions"><Button onClick={onClose}>关闭故障日志</Button></div></Dialog>;
}
