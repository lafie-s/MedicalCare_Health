"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { Dialog } from "./dialog";
import { Button, Notice } from "./ui";
import { requestId } from "./request-id";
type Mode = "off" | "manual" | "window";
type Snapshot = { mode: Mode; allowlist: string[]; reason: string; version: number; updatedAt: number | null; active: boolean; asOf: number; gateMode: "demo" | "nginx" | "unconfigured" };
const modes = { off: "关闭维护，正常访问", manual: "立即开启维护", window: "跟随维护窗口" };
export function MaintenanceAccessDialog({ serviceId, serviceName, role, onClose, onUnauthorized }: { serviceId: string; serviceName: string; role: string; onClose: () => void; onUnauthorized: () => void }) {
  const [data, setData] = useState<Snapshot | null>(null); const [loading, setLoading] = useState(true); const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<Mode>("off"); const [list, setList] = useState(""); const [reason, setReason] = useState(""); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState(false); const [discard, setDiscard] = useState(false); const [busy, setBusy] = useState(false); const [now, setNow] = useState(Date.now());
  const pending = useRef(false); const auth = useRef(onUnauthorized); auth.current = onUnauthorized; const retry = useRef<{ id: string; body: string } | null>(null); const reasonField = useRef<HTMLTextAreaElement>(null);
  const dirty = Boolean(data && (mode !== data.mode || list !== data.allowlist.join("\n") || reason));
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError("");
    void api<Snapshot>(`/services/${serviceId}/maintenance-access`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) { setData(result); setMode(result.mode); setList(result.allowlist.join("\n")); setReason(""); retry.current = null; } }).catch((err) => { if (controller.signal.aborted) return; setData(null); if (err instanceof ApiError && [401, 403].includes(err.status)) auth.current(); else setError(err instanceof Error ? err.message : "维护访问配置读取失败"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [serviceId, revision]);
  useEffect(() => { const clock = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(clock); }, []);
  useEffect(() => { if (!dirty) return; const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty]);
  const close = () => { if (pending.current) return; if (dirty) setDiscard(true); else onClose(); };
  function prepare() { if (!reason.trim()) { setError("请填写变更原因"); reasonField.current?.focus(); return; } setError(""); setConfirm(true); }
  async function save() {
    if (!data || pending.current) return;
    const payload = { mode, allowlist: list.split(/\r?\n/).map((item) => item.trim()).filter(Boolean), reason: reason.trim(), version: data.version };
    const body = JSON.stringify(payload); if (retry.current?.body !== body) retry.current = { id: requestId(), body };
    pending.current = true; setBusy(true); setError("");
    try { const result = await api<Snapshot>(`/services/${serviceId}/maintenance-access`, { method: "POST", body: JSON.stringify({ ...payload, idempotencyKey: retry.current.id }) }); setData(result); setMode(result.mode); setList(result.allowlist.join("\n")); setReason(""); setConfirm(false); retry.current = null; setMessage("维护访问配置已保存，入口按最新配置检查访问。"); }
    catch (err) { if (err instanceof ApiError && [401, 403].includes(err.status)) auth.current(); else setError(err instanceof Error ? err.message : "保存失败，请重试"); }
    finally { pending.current = false; setBusy(false); }
  }
  const stale = Boolean(data && now - data.asOf > 30_000);
  return <Dialog title={`${serviceName} · 网站维护`} onCancel={close}>
    {discard ? <><p>尚未保存的维护访问配置将被丢弃。</p><div className="dialog-actions"><Button autoFocus onClick={() => setDiscard(false)}>继续编辑</Button><Button onClick={onClose}>放弃并关闭</Button></div></> : confirm && data ? <><h3>确认修改维护访问控制</h3><p>{modes[mode]} · 白名单 {list.split(/\r?\n/).filter((item) => item.trim()).length} 条</p><p>{mode === "off" ? "所有访客恢复正常访问。" : "维护生效时，非白名单访客将看到维护页面；空白名单将阻止所有访客。"}</p><p>运维平台入口不受此规则影响。此操作不会更新网站版本。</p>{data.gateMode === "demo" && <Notice>仅控制演示访客入口，不影响真实 MedicalCareWeb。</Notice>}{error && <Notice error>{error}</Notice>}<div className="dialog-actions"><Button disabled={busy} onClick={() => setConfirm(false)}>返回编辑</Button><Button className="primary" busy={busy} onClick={() => void save()}>确认保存维护配置</Button></div></> : <>
      <p>维护期间仅允许白名单 IP / 网段访问网站。其他访客收到维护页面，接口与新连接也会被拦截。</p>
      {loading ? <Notice>正在读取维护访问配置…</Notice> : error && !data ? <Notice error>{error}</Notice> : data && <>
        <Notice>{stale ? "状态已过期，请刷新后核对" : data.active ? "当前维护中 · 仅白名单可访问" : "当前正常访问"} · 配置版本 {data.version}</Notice>
        <p className="muted">最近读取：{new Date(data.asOf).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · 北京时间</p>
        {data.gateMode === "demo" ? <Notice>隔离演示：此规则仅作用于<a href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/site-preview/`} target="_blank" rel="noreferrer">访客演示入口（新窗口）</a>，不影响真实网站。</Notice> : data.gateMode === "unconfigured" ? <Notice>此服务尚未配置维护入口，请联系部署管理员。</Notice> : <Notice>已配置入口鉴权接口；正式生效范围需与部署管理员核对。已有长连接需按部署手册排空。</Notice>}
        <div className="field"><label htmlFor="access-mode">维护模式</label><select id="access-mode" disabled={role !== "admin" || data.gateMode === "unconfigured"} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>{Object.entries(modes).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></div>
        {mode === "window" && <p>使用此服务已登记的维护窗口；开始时生效，到期或取消后恢复访问。</p>}
        <div className="field maintenance-form"><label htmlFor="access-list">IP / 网段白名单（每行一条）</label><textarea className="resize-none" id="access-list" rows={5} maxLength={6500} readOnly={role !== "admin" || data.gateMode === "unconfigured"} value={list} onChange={(e) => setList(e.target.value)} aria-describedby="access-list-help" /><p id="access-list-help" className="muted">支持 IPv4、IPv6 和 CIDR，例如 192.0.2.10、192.0.2.0/24。最多 100 条，禁止 /0。维护时留空将阻止所有访客。</p></div>
        {role === "admin" && data.gateMode !== "unconfigured" && <><div className="field maintenance-form"><label htmlFor="access-reason">变更原因</label><textarea className="resize-none" ref={reasonField} id="access-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></div>{error && <Notice error>{error}</Notice>}<Button className="primary" onClick={prepare}>保存维护配置</Button></>}
        {message && <Notice>{message}</Notice>}
      </>}
      <div className="dialog-actions"><Button disabled={loading || dirty} onClick={() => { setMessage(""); setRevision((v) => v + 1); }}>刷新维护配置</Button><Button onClick={close}>关闭维护面板</Button></div>{dirty && <p className="muted">有未保存修改；关闭时可选择放弃，再重新读取最新配置。</p>}
    </>}
  </Dialog>;
}
