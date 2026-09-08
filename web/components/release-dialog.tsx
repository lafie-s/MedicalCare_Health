"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ReleaseTask } from "../../src/release-store";
import { api, ApiError } from "./api";
import { Dialog } from "./dialog";
import { Button, Notice } from "./ui";
import { requestId } from "./request-id";
type Snapshot = { available: boolean; message?: string; mode: string; releaseId: string | null; healthy: boolean; previousReleaseId: string | null; active: ReleaseTask | null; tasks: ReleaseTask[]; releases: { id: string; name: string; notes: string; publishedAt: string }[]; asOf: number };
const states = { running: "执行中", succeeded: "成功", failed: "未生效", unknown: "结果待核对" };
const time = (at: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "medium" }).format(at);
export function ReleaseDialog({ serviceId, serviceName, role, onClose, onUnauthorized }: { serviceId: string; serviceName: string; role: string; onClose: () => void; onUnauthorized: () => void }) {
  const [data, setData] = useState<Snapshot | null>(null); const [revision, setRevision] = useState(0); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [target, setTarget] = useState(""); const [reason, setReason] = useState(""); const [backup, setBackup] = useState(""); const [confirmation, setConfirmation] = useState<{ action: "update" | "rollback"; from: string; to: string } | null>(null); const [discard, setDiscard] = useState(false); const [reconcile, setReconcile] = useState(false);
  const [busy, setBusy] = useState(false); const pending = useRef(false); const id = useRef(requestId()); const auth = useRef(onUnauthorized); auth.current = onUnauthorized; const form = useRef<HTMLFormElement>(null);
  const dirty = Boolean(reason || backup || confirmation);
  useEffect(() => { if (!dirty) return; const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty]);
  useEffect(() => {
    if (confirmation || reconcile) return;
    const controller = new AbortController(); setLoading(true); setError("");
    void api<Snapshot>(`/services/${serviceId}/releases`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) { setData(result); if (result.available && !result.active) setMessage(""); } }).catch((err) => { if (controller.signal.aborted) return; setData(null); if (err instanceof ApiError && [401, 403].includes(err.status)) auth.current(); else setError(err instanceof Error ? err.message : "版本信息读取失败"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [serviceId, revision, confirmation, reconcile]);
  useEffect(() => { if (loading || confirmation || reconcile || discard) return; const timer = setInterval(() => { if (document.visibilityState === "visible") setRevision((value) => value + 1); }, 5000); return () => clearInterval(timer); }, [confirmation, reconcile, discard, loading]);
  const close = () => { if (pending.current) return; if (dirty) setDiscard(true); else onClose(); };
  function prepare(action: "update" | "rollback", to: string) {
    if (!data?.releaseId || !data.healthy || data.active || !to) return;
    id.current = requestId(); setError(""); setConfirmation({ action, from: data.releaseId, to });
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending.current || !confirmation) return;
    const missing = !reason.trim() ? "reason" : !backup.trim() ? "backup" : "";
    if (missing) { setError("请填写变更原因和已验证备份记录编号；演示可填写“演示验证”。"); (form.current?.elements.namedItem(missing) as HTMLElement)?.focus(); return; }
    pending.current = true; setBusy(true); setError("");
    try {
      await api(`/services/${serviceId}/release`, { method: "POST", body: JSON.stringify({ id: id.current, to: confirmation.to, expected: confirmation.from, action: confirmation.action, reason, backupReference: backup }) });
      setConfirmation(null); setReason(""); setBackup(""); setTarget(""); setMessage("任务已提交，关闭面板不会取消任务。请等待健康检查结果。"); setRevision((value) => value + 1);
    } catch (err) { if (err instanceof ApiError && [401, 403].includes(err.status)) auth.current(); else setError(err instanceof Error ? err.message : "请求结果不确定，请用相同内容重试"); }
    finally { pending.current = false; setBusy(false); }
  }
  async function checkResult() {
    if (pending.current) return; pending.current = true; setBusy(true); setError("");
    try { await api(`/services/${serviceId}/release-reconcile`, { method: "POST", body: JSON.stringify({ executionStopped: true }) }); setReconcile(false); setRevision((value) => value + 1); }
    catch (err) { if (err instanceof ApiError && [401, 403].includes(err.status)) auth.current(); else setError(err instanceof Error ? err.message : "核对失败"); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Dialog title={`${serviceName} · 网站版本更新`} onCancel={close}>
    {discard ? <><p>尚未提交的变更内容将被丢弃。</p><div className="dialog-actions"><Button autoFocus onClick={() => setDiscard(false)}>继续编辑</Button><Button onClick={onClose}>放弃并关闭</Button></div></> : <>
    {data?.mode === "demo" && <Notice>演示更新：仅改变示例版本，不部署真实网站。</Notice>}{error && <Notice error>{error}</Notice>}
    {confirmation ? <form ref={form} className="maintenance-form" noValidate onSubmit={submit}><h3>{confirmation.action === "rollback" ? "确认回退" : "确认更新"}</h3><p>{confirmation.from} → {confirmation.to}</p><Notice>将切换网站与聊天服务镜像并检查健康状态，期间可能短暂不可用。不执行数据库迁移。请确认备份已验证且目标版本兼容当前数据库。</Notice><label htmlFor="release-reason">变更原因</label><input autoFocus id="release-reason" name="reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /><label htmlFor="release-backup">已验证备份记录编号</label><input id="release-backup" name="backup" value={backup} maxLength={200} onChange={(event) => setBackup(event.target.value)} /><div className="dialog-actions"><Button disabled={busy} onClick={() => { setConfirmation(null); }}>返回版本列表</Button><Button type="submit" className="primary" busy={busy}>{confirmation.action === "rollback" ? "确认执行回退" : "确认执行更新"}</Button></div></form>
    : reconcile ? <><p>请先在部署机确认上次执行进程已停止。核对只检查原版本或目标版本是否健康，不重新发布。</p><div className="dialog-actions"><Button disabled={busy} onClick={() => setReconcile(false)}>返回版本列表</Button><Button busy={busy} onClick={() => void checkResult()}>执行已停止，核对状态</Button></div></>
    : <><div className="dialog-actions"><Button busy={loading} onClick={() => setRevision((value) => value + 1)}>刷新版本</Button></div>{message && <Notice>{message}</Notice>}{loading && !data ? <Notice>正在核对当前版本…</Notice> : data && (!data.available ? <Notice>{data.message}</Notice> : <><p>当前版本：<strong>{data.releaseId ?? "无法识别"}</strong> · {data.healthy ? "健康检查通过" : "健康检查未通过"}</p><p className="trend-caption">北京时间 {time(data.asOf)} 查询 · 每 5 秒更新；仅显示批准版本。记录不包含数据库恢复。</p>{data.active && <Notice>{states[data.active.status]}：{data.active.from} → {data.active.to}。{data.active.message}</Notice>}
    {role === "admin" && <><label htmlFor="release-target">已发布版本</label><select id="release-target" value={target} disabled={Boolean(data.active) || loading} onChange={(event) => setTarget(event.target.value)}><option value="">请选择目标版本</option>{data.releases.map((item) => <option key={item.id} value={item.id} disabled={item.id === data.releaseId}>{item.name}{item.id === data.releaseId ? "（当前）" : ""}</option>)}</select>{target && <p>{data.releases.find((item) => item.id === target)?.notes}</p>}<div className="dialog-actions"><Button disabled={loading || !target || !data.releaseId || !data.healthy || Boolean(data.active)} onClick={() => prepare("update", target)}>更新到所选版本</Button><Button disabled={loading || !data.previousReleaseId || !data.releases.some((item) => item.id === data.previousReleaseId) || !data.healthy || Boolean(data.active)} onClick={() => prepare("rollback", data.previousReleaseId!)}>回退到上一版本</Button>{data.active?.status === "unknown" && <Button onClick={() => setReconcile(true)}>核对未确定结果</Button>}</div></>}
    <h3>最近变更记录</h3>{!data.tasks.length ? <Notice>暂无版本更新记录。</Notice> : <ul className="alert-events">{data.tasks.map((task) => <li key={task.id}><strong>{task.action === "rollback" ? "回退" : "更新"} · {states[task.status]}</strong><p>{task.from} → {task.to} · {time(task.createdAt)}</p><p>操作人：{task.actor} · 原因：{task.reason}</p><p>备份记录：{task.backupReference}</p><p>{task.message}</p></li>)}</ul>}<p className="trend-caption">最多显示最近 20 条；完整操作索引见审计查询。</p></>)}<div className="dialog-actions"><Button onClick={close}>关闭版本面板</Button></div></>}
    </>}
  </Dialog>;
}
