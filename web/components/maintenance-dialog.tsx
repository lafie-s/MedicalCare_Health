"use client";
import { requestId } from "./request-id";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MaintenanceWindow } from "../../src/maintenance-store";
import { api, ApiError } from "./api";
import { Dialog } from "./dialog";
import { Button, Notice } from "./ui";
import type { Service } from "./service-panel";
type Data = { items: MaintenanceWindow[]; total: number; page: number; pageSize: number; asOf: number };
const labels = { scheduled: "计划中", active: "维护中（记录）", ended: "已结束", canceled: "已取消" };
const time = (value: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
const localValue = (value: number) => new Date(value + 8 * 3600_000).toISOString().slice(0, 16);
export function MaintenanceDialog({ service, role, onClose, onUnauthorized }: { service: Service; role: string; onClose: () => void; onUnauthorized: () => void }) {
  const [data, setData] = useState<Data | null>(null); const [page, setPage] = useState(1); const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [editor, setEditor] = useState<"create" | MaintenanceWindow | null>(null);
  const auth = useRef(onUnauthorized); auth.current = onUnauthorized;
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void api<Data>(`/services/${service.id}/maintenance?page=${page}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) setData(result); }).catch((err) => { if (controller.signal.aborted) return; setData(null); if (err instanceof ApiError && [401, 403].includes(err.status)) auth.current(); else setError(err instanceof Error ? err.message : "维护窗口读取失败"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [service.id, page, revision]);
  if (editor) return <MaintenanceForm service={service} window={editor === "create" ? null : editor} onBack={() => setEditor(null)} onUnauthorized={() => auth.current()} onSaved={() => { setEditor(null); setMessage("维护记录已保存。"); setRevision((value) => value + 1); }} />;
  return <Dialog title={`${service.name} · 维护窗口`} onCancel={onClose}><Notice>维护窗口不停止采集或静默告警。如果网站维护已设为跟随窗口，窗口期间将限制非白名单访问。</Notice><div className="dialog-actions"><Button busy={loading} onClick={() => setRevision((value) => value + 1)}>刷新窗口</Button>{role !== "viewer" && <Button onClick={() => setEditor("create")}>登记维护窗口</Button>}</div>{message && <Notice>{message}</Notice>}{error && <Notice error>{error}</Notice>}{loading ? <Notice>正在读取维护窗口…</Notice> : data && <><p className="trend-caption">查询快照 · 北京时间 {time(data.asOf)}；刷新获取最新状态。</p>{!data.items.length && <Notice>尚无维护窗口记录。</Notice>}<ul className="alert-events">{data.items.map((window) => <li key={window.id}><strong>{labels[window.status]}</strong><p>{time(window.startsAt)} 至 {time(window.endsAt)} · 北京时间</p><p>负责人：{window.owner}</p><p>维护原因：{window.reason}</p>{window.cancelReason && <p>取消原因：{window.cancelReason}</p>}{role !== "viewer" && ["scheduled", "active"].includes(window.status) && <Button onClick={() => setEditor(window)}>取消此窗口</Button>}</li>)}</ul><div className="inline-actions"><Button disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>上一页窗口</Button><span>第 {data.page} 页 · 共 {data.total} 条</span><Button disabled={data.page * data.pageSize >= data.total} onClick={() => setPage(data.page + 1)}>下一页窗口</Button></div></>}<div className="dialog-actions"><Button onClick={onClose}>关闭维护面板</Button></div></Dialog>;
}
function MaintenanceForm({ service, window, onBack, onSaved, onUnauthorized }: { service: Service; window: MaintenanceWindow | null; onBack: () => void; onSaved: () => void; onUnauthorized: () => void }) {
  const [initial] = useState(() => ({ startsAt: localValue(Date.now() + 300_000), endsAt: localValue(Date.now() + 3900_000), owner: service.owner, reason: "" }));
  const [draft, setDraft] = useState(initial); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [invalid, setInvalid] = useState(""); const [discard, setDiscard] = useState(false);
  const id = useRef(requestId()); const pending = useRef(false); const form = useRef<HTMLFormElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  useEffect(() => { if (!dirty) return; const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; globalThis.window.addEventListener("beforeunload", guard); return () => globalThis.window.removeEventListener("beforeunload", guard); }, [dirty]);
  const cancel = () => { if (pending.current) return; if (dirty) setDiscard(true); else onBack(); };
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending.current) return;
    const startsAt = Date.parse(`${draft.startsAt}+08:00`); const endsAt = Date.parse(`${draft.endsAt}+08:00`);
    const field = !window && (!Number.isFinite(startsAt) || startsAt < Date.now() || startsAt > Date.now() + 30 * 86_400_000) ? "startsAt" : !window && (!Number.isFinite(endsAt) || endsAt <= startsAt || endsAt - startsAt > 86_400_000) ? "endsAt" : !window && !draft.owner.trim() ? "owner" : !draft.reason.trim() ? "reason" : "";
    setInvalid(field); setError("");
    if (field) { setError("请填写负责人和原因；开始须在未来 30 天内，结束晚于开始且最长 24 小时。"); (form.current?.elements.namedItem(field) as HTMLElement)?.focus(); return; }
    pending.current = true; setBusy(true);
    try { await api(window ? `/maintenance/${window.id}/cancel` : `/services/${service.id}/maintenance`, { method: "POST", body: JSON.stringify(window ? { reason: draft.reason } : { idempotencyKey: id.current, startsAt, endsAt, owner: draft.owner, reason: draft.reason }) }); onSaved(); }
    catch (err) { if (err instanceof ApiError && [401, 403].includes(err.status)) onUnauthorized(); else setError(err instanceof Error ? err.message : "保存失败，请重试"); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Dialog title={window ? "取消维护窗口" : "登记维护窗口"} onCancel={cancel}>{discard ? <><p>未保存的维护内容将被丢弃。</p><div className="dialog-actions"><Button autoFocus onClick={() => setDiscard(false)}>继续编辑</Button><Button onClick={onBack}>放弃修改</Button></div></> : <form ref={form} noValidate onSubmit={submit} className="maintenance-form">
    {window ? <p>确认取消 {service.name} 在 {time(window.startsAt)} 至 {time(window.endsAt)} 的维护记录。取消立即生效，历史保留。</p> : <><p>填写北京时间。如果网站维护设为跟随窗口，此时间段会限制非白名单访问。</p><label htmlFor="maintenance-start">开始时间 · 北京时间</label><input autoFocus type="datetime-local" id="maintenance-start" name="startsAt" value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} aria-invalid={invalid === "startsAt"} aria-describedby="maintenance-error" /><label htmlFor="maintenance-end">结束时间 · 北京时间</label><input type="datetime-local" id="maintenance-end" name="endsAt" value={draft.endsAt} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} aria-invalid={invalid === "endsAt"} aria-describedby="maintenance-error" /><label htmlFor="maintenance-owner">负责人</label><input id="maintenance-owner" name="owner" maxLength={80} value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} aria-invalid={invalid === "owner"} aria-describedby="maintenance-error" /></>}
    <label htmlFor="maintenance-reason">{window ? "取消原因" : "维护原因"}</label><textarea className="resize-none" autoFocus={Boolean(window)} id="maintenance-reason" name="reason" rows={4} maxLength={500} value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} aria-invalid={invalid === "reason"} aria-describedby="maintenance-error" /><div id="maintenance-error" className="service-form-feedback">{error && <Notice error>{error}</Notice>}</div><div className="dialog-actions"><Button type="button" disabled={busy} onClick={cancel}>返回维护列表</Button><Button type="submit" className="primary" busy={busy}>{window ? "确认取消窗口" : "保存维护窗口"}</Button></div>
  </form>}</Dialog>;
}
