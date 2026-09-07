"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { LoginForm } from "./login-form";
import { Brand, Button, Notice } from "./ui";
import { ServicePanel } from "./service-panel";
import { AuditPanel } from "./audit-panel";

type User = { displayName: string; role: "viewer" | "operator" | "admin"; expiresAt: string };
type Environment = { id: string; name: string; type: "development" | "staging" | "production" };
type State = { kind: "loading" } | { kind: "login"; message: string } | { kind: "error"; message: string } | { kind: "ready"; user: User; environments: Environment[] };
const roles = { viewer: "只读观察者", operator: "运维人员", admin: "管理员" };
const types = { development: "开发环境", staging: "预发布环境", production: "生产环境" };

export function Console() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const signingOut = useRef(false);
  const load = useCallback(async () => {
    if (signingOut.current) return;
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setState({ kind: "loading" }); setError("");
    try {
      const user = await api<User>("/me", { signal: controller.signal });
      const { items } = await api<{ items: Environment[] }>("/environments", { signal: controller.signal });
      if (controller.signal.aborted) return;
      const id = new URL(location.href).searchParams.get("environment");
      const chosen = items.find((item) => item.id === id)?.id ?? items[0]?.id ?? "";
      setSelected(chosen);
      const url = new URL(location.href); if (chosen) url.searchParams.set("environment", chosen); else url.searchParams.delete("environment"); history.replaceState(null, "", url);
      setState({ kind: "ready", user, environments: items });
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof ApiError && [401, 403].includes(err.status)) setState({ kind: "login", message: err.status === 403 ? err.message : "" });
      else setState({ kind: "error", message: err instanceof Error ? err.message : "加载失败，请重试" });
    }
  }, []);
  useEffect(() => { void load(); return () => active.current?.abort(); }, [load]);
  useEffect(() => {
    document.title = `${state.kind === "login" ? "员工登录" : state.kind === "error" ? "连接异常" : "运维工作台"} · MedicalCare Health`;
    if (state.kind !== "ready") return;
    const refresh = () => { if (document.visibilityState === "visible" && !document.querySelector("dialog[open]")) void load(); };
    const timer = setTimeout(() => { active.current?.abort(); setState({ kind: "login", message: "会话已到期，请重新登录" }); }, Math.max(0, Date.parse(state.user.expiresAt) - Date.now()));
    document.addEventListener("visibilitychange", refresh);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [state, load]);
  async function logout() {
    if (signingOut.current) return;
    signingOut.current = true; active.current?.abort(); setBusy(true); setError("");
    try { await api("/auth/logout", { method: "POST" }); setState({ kind: "login", message: "" }); }
    catch (err) { setError(err instanceof Error ? err.message : "退出失败，请重试"); }
    finally { signingOut.current = false; setBusy(false); }
  }
  if (state.kind === "login") return <LoginForm message={state.message} onSuccess={() => void load()} />;
  if (state.kind === "loading") return <main className="standalone"><Brand /><Notice>正在验证访问权限…</Notice></main>;
  if (state.kind === "error") return <main className="standalone"><Brand /><h1>暂时无法连接工作台</h1><Notice error>{state.message}</Notice><Button className="primary" onClick={() => void load()}>重新连接</Button></main>;
  const environment = state.environments.find((item) => item.id === selected);
  return <div className="console-layout"><aside className="sidebar"><Brand /><p className="nav-label">工作空间</p><span className="nav-current">授权环境</span><div className="sidebar-bottom"><p>MedicalCareWeb</p><span>运行指标监测及维护</span></div></aside>
    <main className="workspace"><header className="workspace-header"><span>运维工作台 <span className="muted">/ 授权环境</span></span><div className="user-actions"><span>{state.user.displayName}<small>{roles[state.user.role]}</small></span><Button busy={busy} onClick={() => void logout()}>退出登录</Button></div></header>
      <div className="workspace-content"><div className="page-heading"><div><p className="eyebrow">工作空间</p><h1>选择运维环境</h1><p className="muted">仅展示你获准访问的环境。进入前请核对环境类型。</p></div><Button onClick={() => void load()}>刷新环境</Button></div>{error && <Notice error>{error}</Notice>}
        {state.environments.length === 0 ? <Notice>暂无可访问环境，请联系管理员配置环境权限。</Notice> : <div className="environment-workspace"><section className="environment-list" aria-label="授权环境"><div className="panel-heading">可访问环境 <span>{state.environments.length}</span></div><ul>{state.environments.map((item) => <li key={item.id}><button className={`environment-option ${selected === item.id ? "selected" : ""}`} aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); const url = new URL(location.href); url.searchParams.set("environment", item.id); url.searchParams.delete("alertState"); url.searchParams.delete("alertPage"); for (const key of ["auditCategory", "auditDays", "auditTo", "auditPage"]) url.searchParams.delete(key); url.hash = ""; history.replaceState(null, "", url); }}><span className="environment-icon" aria-hidden="true">▤</span><span><strong>{item.name}</strong><small>{types[item.type]}</small></span><span aria-hidden="true">→</span></button></li>)}</ul></section>
          <section className="environment-detail" aria-labelledby="environment-title"><div className="panel-heading"><span>当前环境</span><span className="badge">{environment && types[environment.type]}</span></div><h2 id="environment-title">{environment?.name}</h2><p className="technical-id">{environment?.id}</p><div className="environment-guidance"><p>在下方服务目录查看该环境的探测结果与最近采集时间。</p><p>环境与服务配置独立授权，操作前请核对目标。</p></div><p className="detail-note">没有采样或数据过期时，服务状态显示为未知。</p></section></div>}
        {environment && <ServicePanel key={environment.id} environmentId={environment.id} role={state.user.role} onUnauthorized={() => { active.current?.abort(); setState({ kind: "login", message: "会话或权限已失效，请重新登录" }); }} />}
        {environment && state.user.role === "admin" && <AuditPanel key={environment.id} environmentId={environment.id} onUnauthorized={() => { active.current?.abort(); setState({ kind: "login", message: "会话或权限已失效，请重新登录" }); }} />}
      </div><footer className="workspace-footer">MedicalCare Health <span>所有时间均以北京时间显示</span></footer>
    </main></div>;
}
