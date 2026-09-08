"use client";
import { requestId } from "./request-id";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import { Button, Notice } from "./ui";
import { Dialog } from "./dialog";
import { HealthOverview } from "./health-overview";
import { TrendDialog } from "./probe-trend";
import { AlertDialog } from "./alert-dialog";
import { AlertCenter } from "./alert-center";
import { MaintenanceDialog } from "./maintenance-dialog";
import { ReleaseDialog } from "./release-dialog";
import { currentHealth, healthReasons as reasons } from "../../src/health-summary";

type Health = { status: string; reason: string; latest: { startedAt: number; httpStatus: number | null; latencyMs: number | null; outcome: string } | null; availabilityPercent: number | null; samplesInWindow: number; asOf: number };
export type Service = { maintenanceWindow?: { startsAt: number; endsAt: number } | null; id: string; name: string; owner: string; targetId: string; intervalSeconds: number; enabled: boolean; version: number; health: Health };
type Directory = { asOf: number; items: Service[]; targets: { id: string; name: string }[]; limit: number; probingAvailable: boolean };
export function ServicePanel({ environmentId, role, releasePickerOpen, onCloseReleasePicker, onUnauthorized }: { environmentId: string; role: string; releasePickerOpen: boolean; onCloseReleasePicker: () => void; onUnauthorized: () => void }) {
  const [data, setData] = useState<Directory | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [edit, setEdit] = useState<Service | "new" | null>(null);
  const [alerts, setAlerts] = useState<Service | null>(null);
  const [maintenance, setMaintenance] = useState<Service | null>(null);
  const [release, setRelease] = useState<Service | null>(null);
  const [trend, setTrend] = useState<Service | null>(null);
  const [toggle, setToggle] = useState<Service | null>(null);
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState("");
  const [now, setNow] = useState(Date.now());
  const probeKeys = useRef(new Map<string, string>());
  const probePending = useRef(false);
  const modalOpen = useRef(false); modalOpen.current = Boolean(edit || toggle || trend || alerts || maintenance || release || releasePickerOpen);
  const active = useRef<AbortController | null>(null);
  const auth = useRef(onUnauthorized); auth.current = onUnauthorized;
  const load = useCallback(async (background = false) => {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    if (!background) setLoading(true); setError("");
    try { const next = await api<Directory>(`/services?environmentId=${encodeURIComponent(environmentId)}`, { signal: controller.signal }); if (!controller.signal.aborted) setData(next); }
    catch (err) { if (controller.signal.aborted) return; setData(null); if (err instanceof ApiError && [401, 403].includes(err.status)) auth.current(); else setError(err instanceof Error ? err.message : "服务列表加载失败"); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [environmentId]);
  useEffect(() => { void load(); return () => active.current?.abort(); }, [load]);
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const refresh = setInterval(() => { if (!modalOpen.current && !probePending.current && document.visibilityState === "visible") void load(true); }, 30_000);
    return () => { clearInterval(clock); clearInterval(refresh); };
  }, [load]);
  async function probe(service: Service) {
    if (probePending.current) return;
    probePending.current = true; setProbing(service.id); setError(""); setMessage("");
    const key = probeKeys.current.get(service.id) ?? requestId(); probeKeys.current.set(service.id, key);
    try {
      const result = await api<{ outcome: string }>(`/services/${service.id}/probe`, { method: "POST", headers: { "Idempotency-Key": key } });
      if (result.outcome !== "running") probeKeys.current.delete(service.id);
      setMessage(result.outcome === "running" ? "探测正在执行，请稍后刷新结果。" : "探测已完成，结果已更新。");
      await load(true);
    } catch (err) { if (err instanceof ApiError && [401, 403].includes(err.status)) auth.current(); else setError(err instanceof Error ? err.message : "探测请求失败，请重试"); }
    finally { probePending.current = false; setProbing(""); }
  }
  async function changeState() {
    if (!toggle || busy) return;
    setBusy(true); setError("");
    try { await api(`/services/${toggle.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !toggle.enabled, version: toggle.version }) }); setMessage(toggle.enabled ? "服务已停用，采集将停止。" : "服务已启用。"); setToggle(null); await load(); }
    catch (err) { if (err instanceof ApiError && [401, 403].includes(err.status)) auth.current(); else setError(err instanceof Error ? err.message : "保存失败，请重试"); }
    finally { setBusy(false); }
  }
  return <><section className="service-panel" aria-labelledby="services-title"><div className="panel-heading"><h2 id="services-title">服务目录</h2><div className="inline-actions"><Button onClick={() => void load()} busy={loading}>刷新服务</Button>{role === "admin" && <Button className="primary" disabled={!data?.targets.length || loading} onClick={() => { setMessage(""); setEdit("new"); }}>登记服务</Button>}</div></div>
    <div className="service-content">{message && <Notice>{message}</Notice>}{!toggle && error && <Notice error>{error}</Notice>}{loading ? <Notice>正在读取服务配置…</Notice> : data && <>
      <HealthOverview items={data.items} now={now} asOf={data.asOf} />
      {role === "admin" && !data.targets.length && <Notice>当前环境没有获准探测的目标，请先由部署管理员配置目标白名单。</Notice>}
      {data.items.length === 0 ? <div className="empty-services"><h3>尚未登记服务</h3><p>登记服务并关联获准探测的目标后，即可建立运行监测。</p></div> : <ul className="service-list">{data.items.map((service) => <li key={service.id} id={`service-${service.id}`} tabIndex={-1}><div className="service-row"><div><h3>{service.name}</h3><p>{service.owner} · 每 {service.intervalSeconds} 秒采集</p><p>目标：{data.targets.find((target) => target.id === service.targetId)?.name ?? "目标授权已撤销"}</p></div><span className="badge">{service.enabled ? "已启用" : "已停用"}</span></div>{service.maintenanceWindow && now >= service.maintenanceWindow.startsAt && now < service.maintenanceWindow.endsAt && <p className="badge">维护中（记录）· 采集与告警继续</p>}<ProbeInfo service={service} now={now} /><div className="inline-actions service-actions"><Button onClick={() => setRelease(service)}>网站版本 {service.name}</Button><Button onClick={() => setMaintenance(service)}>维护窗口 {service.name}</Button><Button onClick={() => setAlerts(service)}>查看告警 {service.name}</Button><Button onClick={() => setTrend(service)}>查看趋势 {service.name}</Button>{role !== "viewer" && <Button busy={probing === service.id} disabled={!data.probingAvailable || !service.enabled || Boolean(probing) || !data.targets.some((target) => target.id === service.targetId)} onClick={() => void probe(service)}>立即探测 {service.name}</Button>}{role === "admin" && <><Button onClick={() => { setMessage(""); setEdit(service); }}>编辑 {service.name}</Button><Button onClick={() => { setError(""); setToggle(service); }}>{service.enabled ? "停用" : "启用"} {service.name}</Button></>}</div></li>)}</ul>}
      <p className="muted service-count">共 {data.items.length} 个服务 · 每环境上限 {data.limit} 个</p>
    </>}</div>
    {releasePickerOpen && <Dialog title="网站版本更新 · 选择服务" onCancel={onCloseReleasePicker}><p>请选择当前授权环境中的目标服务，查看已发布版本、更新或回退。</p>{loading ? <Notice>正在读取服务配置…</Notice> : error ? <><Notice error>{error}</Notice><Button onClick={() => void load()}>重试加载服务</Button></> : !data?.items.length ? <Notice>当前环境尚未登记服务，请先登记服务并配置批准版本目录。</Notice> : <ul className="service-list">{data.items.map((service) => <li key={service.id}><h3>{service.name}</h3><p>{service.owner}</p><Button className="primary" onClick={() => { onCloseReleasePicker(); setRelease(service); }}>管理网站版本 {service.name}</Button></li>)}</ul>}<div className="dialog-actions"><Button onClick={onCloseReleasePicker}>关闭服务选择</Button></div></Dialog>}
    {release && <ReleaseDialog serviceId={release.id} serviceName={release.name} role={role} onClose={() => { setRelease(null); void load(true); }} onUnauthorized={() => auth.current()} />}
    {maintenance && <MaintenanceDialog service={maintenance} role={role} onClose={() => { setMaintenance(null); void load(true); }} onUnauthorized={() => auth.current()} />}
    {alerts && <AlertDialog service={alerts} role={role} onClose={() => setAlerts(null)} onUnauthorized={() => auth.current()} />}
    {trend && <TrendDialog service={trend} onClose={() => setTrend(null)} onUnauthorized={() => auth.current()} />}
    {edit && data && <ServiceForm key={edit === "new" ? "new" : edit.id} service={edit === "new" ? null : edit} targets={data.targets} environmentId={environmentId} onClose={() => setEdit(null)} onUnauthorized={() => auth.current()} onSaved={() => { setEdit(null); setMessage("服务配置已保存。"); void load(); }} />}
    {toggle && <Dialog title={`${toggle.enabled ? "停用" : "启用"} ${toggle.name}`} onCancel={() => { if (!busy) setToggle(null); }}><p>{toggle.enabled ? "停用后不再采集该服务的运行指标，已有记录会保留。" : "启用后将按配置恢复采集。"}</p>{error && <Notice error>{error}</Notice>}<div className="dialog-actions"><Button autoFocus disabled={busy} onClick={() => setToggle(null)}>取消</Button><Button className="primary" busy={busy} onClick={() => void changeState()}>{toggle.enabled ? "确认停用" : "确认启用"}</Button></div></Dialog>}
  </section><AlertCenter environmentId={environmentId} revision={0} paused={Boolean(edit || toggle || trend || alerts || maintenance || release || releasePickerOpen)} onUnauthorized={() => auth.current()} onOpen={(id) => { const service = data?.items.find((item) => item.id === id); if (service) setAlerts(service); else { setError("服务目录暂不可用，请刷新服务后重试"); } }} /></>;
}

function ProbeInfo({ service, now }: { service: Service; now: number }) {
  const health = service.health;
  const sample = health.latest;
  const { reason } = currentHealth(service, now);
  const current = ["success", "http_error", "timeout", "connection_error"].includes(reason);
  const timestamp = sample ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(sample.startedAt) : "尚未采集";
  return <div className="probe-info"><div className={`probe-state ${current && reason !== "success" ? "probe-error" : ""}`}><strong>{reasons[reason] ?? "状态未知"}</strong>{!current && reason !== "disabled" && <span> · 状态未知</span>}</div><dl><div><dt>最近响应耗时</dt><dd>{current && sample?.latencyMs !== null && sample?.latencyMs !== undefined ? `${sample.latencyMs} ms` : "—"}</dd></div><div><dt>5 分钟探测成功率</dt><dd>{current && health.availabilityPercent !== null ? `${health.availabilityPercent}%` : "—"}<small> / {health.samplesInWindow} 个有效样本</small></dd></div><div><dt>最近采集时间 · 北京时间</dt><dd>{timestamp}</dd></div></dl>{sample?.httpStatus && current && <p>HTTP {sample.httpStatus}</p>}<p>耗时统计到收到响应头；不代表完整业务请求耗时。</p></div>;
}

function ServiceForm({ service, targets, environmentId, onClose, onSaved, onUnauthorized }: { service: Service | null; targets: Directory["targets"]; environmentId: string; onClose: () => void; onSaved: () => void; onUnauthorized: () => void }) {
  const initial = { name: service?.name ?? "", owner: service?.owner ?? "", targetId: service?.targetId ?? "", intervalSeconds: service?.intervalSeconds ?? 30 };
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState("");
  const [discard, setDiscard] = useState(false);
  const id = useRef(requestId());
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
