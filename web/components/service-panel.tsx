"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import { Button, Notice } from "./ui";
import { Dialog } from "./dialog";

export type Service = { id: string; name: string; owner: string; targetId: string; intervalSeconds: number; enabled: boolean; version: number };
type Directory = { items: Service[]; targets: { id: string; name: string }[]; limit: number };
export function ServicePanel({ environmentId, role, onUnauthorized }: { environmentId: string; role: string; onUnauthorized: () => void }) {
  const [data, setData] = useState<Directory | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [edit, setEdit] = useState<Service | "new" | null>(null);
  const [toggle, setToggle] = useState<Service | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const auth = useRef(onUnauthorized); auth.current = onUnauthorized;
  const load = useCallback(async () => {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setLoading(true); setError("");
    try { const next = await api<Directory>(`/services?environmentId=${encodeURIComponent(environmentId)}`, { signal: controller.signal }); if (!controller.signal.aborted) setData(next); }
    catch (err) { if (controller.signal.aborted) return; setData(null); if (err instanceof ApiError && [401, 403].includes(err.status)) auth.current(); else setError(err instanceof Error ? err.message : "服务列表加载失败"); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [environmentId]);
  useEffect(() => { void load(); return () => active.current?.abort(); }, [load]);
  async function changeState() {
    if (!toggle || busy) return;
    setBusy(true); setError("");
    try { await api(`/services/${toggle.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !toggle.enabled, version: toggle.version }) }); setMessage(toggle.enabled ? "服务已停用，采集将停止。" : "服务已启用。"); setToggle(null); await load(); }
    catch (err) { if (err instanceof ApiError && [401, 403].includes(err.status)) auth.current(); else setError(err instanceof Error ? err.message : "保存失败，请重试"); }
    finally { setBusy(false); }
  }
  return <section className="service-panel" aria-labelledby="services-title"><div className="panel-heading"><h2 id="services-title">服务目录</h2><div className="inline-actions"><Button onClick={() => void load()} busy={loading}>刷新服务</Button>{role === "admin" && <Button className="primary" disabled={!data?.targets.length || loading} onClick={() => { setMessage(""); setEdit("new"); }}>登记服务</Button>}</div></div>
    <div className="service-content">{message && <Notice>{message}</Notice>}{!toggle && error && <Notice error>{error}</Notice>}{loading ? <Notice>正在读取服务配置…</Notice> : data && <>
      {role === "admin" && !data.targets.length && <Notice>当前环境没有获准探测的目标，请先由部署管理员配置目标白名单。</Notice>}
      {data.items.length === 0 ? <div className="empty-services"><h3>尚未登记服务</h3><p>登记服务并关联获准探测的目标后，即可建立运行监测。</p></div> : <ul className="service-list">{data.items.map((service) => <li key={service.id}><div className="service-row"><div><h3>{service.name}</h3><p>{service.owner} · 每 {service.intervalSeconds} 秒采集</p><p>目标：{data.targets.find((target) => target.id === service.targetId)?.name ?? "目标授权已撤销"}</p></div><span className="badge">{service.enabled ? "已启用" : "已停用"}</span></div>{role === "admin" && <div className="inline-actions service-actions"><Button onClick={() => { setMessage(""); setEdit(service); }}>编辑 {service.name}</Button><Button onClick={() => { setError(""); setToggle(service); }}>{service.enabled ? "停用" : "启用"} {service.name}</Button></div>}</li>)}</ul>}
      <p className="muted service-count">共 {data.items.length} 个服务 · 每环境上限 {data.limit} 个</p>
    </>}</div>
    {edit && data && <ServiceForm key={edit === "new" ? "new" : edit.id} service={edit === "new" ? null : edit} targets={data.targets} environmentId={environmentId} onClose={() => setEdit(null)} onUnauthorized={() => auth.current()} onSaved={() => { setEdit(null); setMessage("服务配置已保存。"); void load(); }} />}
    {toggle && <Dialog title={`${toggle.enabled ? "停用" : "启用"} ${toggle.name}`} onCancel={() => { if (!busy) setToggle(null); }}><p>{toggle.enabled ? "停用后不再采集该服务的运行指标，已有记录会保留。" : "启用后将按配置恢复采集。"}</p>{error && <Notice error>{error}</Notice>}<div className="dialog-actions"><Button autoFocus disabled={busy} onClick={() => setToggle(null)}>取消</Button><Button className="primary" busy={busy} onClick={() => void changeState()}>{toggle.enabled ? "确认停用" : "确认启用"}</Button></div></Dialog>}
  </section>;
}

function ServiceForm({ service, targets, environmentId, onClose, onSaved, onUnauthorized }: { service: Service | null; targets: Directory["targets"]; environmentId: string; onClose: () => void; onSaved: () => void; onUnauthorized: () => void }) {
  const initial = { name: service?.name ?? "", owner: service?.owner ?? "", targetId: service?.targetId ?? "", intervalSeconds: service?.intervalSeconds ?? 30 };
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState("");
  const [discard, setDiscard] = useState(false);
  const id = useRef(crypto.randomUUID());
  const form = useRef<HTMLFormElement>(null);
  const pending = useRef(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  useEffect(() => { if (!dirty) return; const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty]);
  const cancel = () => { if (!busy) { if (dirty) setDiscard(true); else onClose(); } };
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending.current) return;
    const field = !value.name.trim() ? "name" : !value.owner.trim() ? "owner" : !targets.some((target) => target.id === value.targetId) ? "targetId" : "";
    setInvalid(field); setError("");
    if (field) { setError("请填写名称、负责人并选择获准探测的目标。"); (form.current?.elements.namedItem(field) as HTMLElement)?.focus(); return; }
    pending.current = true; setBusy(true);
    try { await api(service ? `/services/${service.id}` : "/services", { method: service ? "PATCH" : "POST", body: JSON.stringify(service ? { ...value, version: service.version } : { ...value, environmentId, idempotencyKey: id.current }) }); onSaved(); }
    catch (err) { if (err instanceof ApiError && [401, 403].includes(err.status)) onUnauthorized(); else setError(err instanceof Error ? err.message : "保存失败，请重试"); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Dialog title={service ? "编辑服务" : "登记服务"} onCancel={cancel}>{discard ? <><p>未保存的服务配置将被丢弃。</p><div className="dialog-actions"><Button autoFocus onClick={() => setDiscard(false)}>继续编辑</Button><Button onClick={onClose}>放弃修改</Button></div></> : <form ref={form} noValidate onSubmit={submit} onKeyDown={(event) => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }}>
    <div className="field"><label htmlFor="service-name">服务名称</label><input autoFocus id="service-name" name="name" maxLength={80} value={value.name} onChange={(event) => setValue({ ...value, name: event.target.value })} aria-invalid={invalid === "name"} aria-describedby="service-error" /></div>
    <div className="field"><label htmlFor="service-owner">负责人</label><input id="service-owner" name="owner" maxLength={80} value={value.owner} onChange={(event) => setValue({ ...value, owner: event.target.value })} aria-invalid={invalid === "owner"} aria-describedby="service-error" /></div>
    <div className="field"><label htmlFor="service-target">探测目标</label><select id="service-target" name="targetId" value={value.targetId} onChange={(event) => setValue({ ...value, targetId: event.target.value })} aria-invalid={invalid === "targetId"} aria-describedby="service-error"><option value="">请选择获准探测的目标</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></div>
    <div className="field"><label htmlFor="service-interval">采集间隔</label><select id="service-interval" value={value.intervalSeconds} onChange={(event) => setValue({ ...value, intervalSeconds: Number(event.target.value) })}><option value={30}>30 秒</option><option value={60}>60 秒</option><option value={300}>5 分钟</option></select></div>
    <div id="service-error" className="service-form-feedback">{error && <Notice error>{error}</Notice>}</div><div className="dialog-actions"><Button type="button" disabled={busy} onClick={cancel}>取消</Button><Button type="submit" className="primary" busy={busy}>保存配置</Button></div>
  </form>}</Dialog>;
}
