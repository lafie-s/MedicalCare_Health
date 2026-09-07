"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AlertEvent, AlertRule, AlertRuleInput } from "../../src/alert-store";
import type { Service } from "./service-panel";
import { healthReasons } from "../../src/health-summary";
import { api, ApiError } from "./api";
import { Dialog } from "./dialog";
import { Button, Notice } from "./ui";
type Data = { rule: AlertRule | null; items: AlertEvent[]; total: number; page: number; pageSize: number; health: { reason: string }; asOf: number };
const defaults: AlertRuleInput = { failureCount: 3, recoveryCount: 2, severity: "warning", enabled: false };
const labels = { firing: "待确认", acknowledged: "已确认，尚未恢复", recovered: "已恢复", closed: "已关闭", terminated: "已终止" };
const endReasons: Record<string, string> = { rule_changed: "规则变更", rule_disabled: "规则停用", service_changed: "服务配置变更", service_disabled: "服务停用", target_changed: "目标变更", target_unavailable: "目标或环境不可用" };
const time = (value: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(value);
export function AlertDialog({ service, role, onClose, onUnauthorized }: { service: Service; role: string; onClose: () => void; onUnauthorized: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<AlertRuleInput>(defaults);
  const [initial, setInitial] = useState<AlertRuleInput>(defaults);
  const [page, setPage] = useState(1); const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState(false); const [discard, setDiscard] = useState(false);
  const pending = useRef(false); const auth = useRef(onUnauthorized); auth.current = onUnauthorized;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void api<Data>(`/services/${service.id}/alerts?page=${page}`, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return; setData(result);
      const input = result.rule ? { failureCount: result.rule.failureCount, recoveryCount: result.rule.recoveryCount, severity: result.rule.severity, enabled: result.rule.enabled } : defaults;
      setDraft(input); setInitial(input);
    }).catch((err) => { if (!controller.signal.aborted) { setData(null); if (err instanceof ApiError && [401, 403].includes(err.status)) auth.current(); else setError(err instanceof Error ? err.message : "告警加载失败"); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [service.id, page, revision]);
  useEffect(() => { if (!dirty) return; const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty]);
  const cancel = () => { if (pending.current) return; if (confirm) setConfirm(false); else if (dirty) setDiscard(true); else onClose(); };
  async function mutate(path: string, method: string, body?: object) {
    if (pending.current) return; pending.current = true; setBusy(true); setError(""); setMessage("");
    try {
      await api(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      setConfirm(false); setMessage("操作已保存。"); setRevision((value) => value + 1);
    } catch (err) { if (err instanceof ApiError && [401, 403].includes(err.status)) auth.current(); else setError(err instanceof Error ? err.message : "操作失败，请重试"); }
    finally { pending.current = false; setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); if (!busy && dirty) setConfirm(true); }
  return <Dialog title={`${service.name} · HTTP 告警`} onCancel={cancel}>
    {discard ? <><p>未保存的告警规则将被丢弃。</p><div className="dialog-actions"><Button autoFocus onClick={() => setDiscard(false)}>继续编辑</Button><Button onClick={onClose}>放弃修改</Button></div></> : <>
      {message && <Notice>{message}</Notice>}{error && <Notice error>{error}</Notice>}
      {confirm ? <><p>保存将重新开始连续计数，并终止当前未恢复事件，保留历史及终止原因。规则仅在启用后对新采样生效。</p><div className="dialog-actions"><Button autoFocus disabled={busy} onClick={() => setConfirm(false)}>返回编辑</Button><Button busy={busy} className="primary" onClick={() => void mutate(`/services/${service.id}/alert-rule`, "PUT", { ...draft, version: data?.rule?.version ?? 0 })}>确认保存规则</Button></div></> : <>
        <div className="inline-actions"><Button disabled={dirty || busy} busy={loading} onClick={() => setRevision((value) => value + 1)}>刷新告警</Button></div>
        {loading ? <Notice>正在读取告警规则与事件…</Notice> : data && <>
          <p className="trend-caption">查询时间 · 北京时间 {time(data.asOf)} · 采样状态：{healthReasons[data.health.reason] ?? "未知"}。这是查询快照，请刷新查看最新状态。</p>
          <Notice>确认只代表有人跟进，不代表恢复。无数据不恢复告警；本阶段不发送外部通知。</Notice>
          {role === "admin" ? <form noValidate onSubmit={submit} className="alert-rule-form"><h3>连续失败规则</h3>
            <label htmlFor="alert-failures">触发所需连续失败次数</label><select id="alert-failures" value={draft.failureCount} onChange={(event) => setDraft({ ...draft, failureCount: Number(event.target.value) })}>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>{i + 1} 次</option>)}</select>
            <label htmlFor="alert-recoveries">恢复所需连续成功次数</label><select id="alert-recoveries" value={draft.recoveryCount} onChange={(event) => setDraft({ ...draft, recoveryCount: Number(event.target.value) })}>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>{i + 1} 次</option>)}</select>
            <label htmlFor="alert-severity">告警等级</label><select id="alert-severity" value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value as AlertRuleInput["severity"] })}><option value="warning">警告</option><option value="critical">严重</option></select>
            <label htmlFor="alert-enabled">规则状态</label><select id="alert-enabled" value={String(draft.enabled)} onChange={(event) => setDraft({ ...draft, enabled: event.target.value === "true" })}><option value="false">停用</option><option value="true">启用</option></select>
            <p className="trend-caption">首次默认停用。示例次数不代表生产阈值，需由管理员根据运行基线确定。</p><Button type="submit" className="primary" disabled={!dirty || busy}>保存规则</Button></form> : <p className="trend-caption">{data.rule ? `规则${data.rule.enabled ? "启用" : "停用"}：连续失败 ${data.rule.failureCount} 次触发，连续成功 ${data.rule.recoveryCount} 次恢复。` : "尚未配置告警规则，请联系管理员。"}</p>}
          <h3 className="alert-events-title">告警事件</h3>{!data.items.length && <Notice>本页没有告警事件。</Notice>}
          <ul className="alert-events">{data.items.map((event) => <li key={event.id}><strong>{event.severity === "critical" ? "严重" : "警告"} · {labels[event.state]}</strong><p>触发 {time(event.openedAt)} · 最近样本 {time(event.lastSeen)}</p>{event.acknowledgedBy && <p>确认人：{event.acknowledgedBy}</p>}{event.recoveredAt !== null && <p>恢复 {time(event.recoveredAt)}</p>}{event.endedAt !== null && <p>结束 {time(event.endedAt)}{event.reason ? ` · ${endReasons[event.reason] ?? event.reason}` : ""}</p>}<div className="inline-actions">{role !== "viewer" && event.state === "firing" && <Button disabled={busy || dirty} onClick={() => void mutate(`/alerts/${event.id}/acknowledge`, "POST")}>确认告警</Button>}{role !== "viewer" && event.state === "recovered" && <Button disabled={busy || dirty} onClick={() => void mutate(`/alerts/${event.id}/close`, "POST")}>关闭已恢复事件</Button>}</div></li>)}</ul>
          <div className="inline-actions"><Button disabled={page <= 1 || busy || dirty} onClick={() => setPage((value) => value - 1)}>上一页</Button><span>第 {page} 页 · 共 {data.total} 条</span><Button disabled={page * data.pageSize >= data.total || busy || dirty} onClick={() => setPage((value) => value + 1)}>下一页</Button></div>
        </>}
      </>}
      <div className="dialog-actions"><Button disabled={busy} onClick={cancel}>关闭告警面板</Button></div>
    </>}
  </Dialog>;
}
