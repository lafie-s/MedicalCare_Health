"use client";
import { useRef, useState, type FormEvent } from "react";
import { api } from "./api";
import { Brand, Button, Notice } from "./ui";

export function LoginForm({ message, onSuccess }: { message: string; onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(message);
  const [errors, setErrors] = useState({ email: "", password: "" });
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const next = { email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? "" : "请输入有效的员工邮箱", password: password ? "" : "请输入员工密码" };
    setErrors(next); setError("");
    if (next.email || next.password) { (next.email ? emailRef : passwordRef).current?.focus(); return; }
    pending.current = true; setBusy(true);
    try { await api("/auth/login", { method: "POST", body: JSON.stringify({ email: email.trim(), password }) }); setPassword(""); onSuccess(); }
    catch (err) { setError(err instanceof Error ? err.message : "登录失败，请重试"); setPassword(""); passwordRef.current?.focus(); }
    finally { pending.current = false; setBusy(false); }
  }
  if (process.env.NEXT_PUBLIC_PREVIEW === "1") return <main className="standalone"><Brand /><h1>运维平台演示</h1><Notice>隔离演示环境，仅含示例数据。不要输入真实账号或业务信息。数据会在重启后重置。</Notice>{error && <Notice error>{error}</Notice>}<Button className="primary" busy={busy} onClick={async () => { if (pending.current) return; pending.current = true; setBusy(true); try { await api("/auth/login", { method: "POST", body: JSON.stringify({ email: "demo@example.test", password: "preview-only" }) }); onSuccess(); } catch (err) { setError(err instanceof Error ? err.message : "演示暂不可用"); } finally { pending.current = false; setBusy(false); } }}>进入演示工作台</Button></main>;
  return <main className="login-layout">
    <section className="login-context"><Brand /><div className="login-intro"><p className="eyebrow">MedicalCareWeb · 运行维护</p><h1>每个环境，<br />都有清晰的运行视野。</h1><p>从服务可用性到关键依赖，<br />让运行状态与维护记录有据可查。</p><div className="service-map" aria-label="监测范围示意"><span>服务可用性</span><span>接口性能</span><span>关键依赖</span></div><p className="map-caption">监测范围示意 · 非实时数据</p></div><p className="context-footer">运行指标监测及维护平台</p></section>
    <section className="login-main" aria-labelledby="login-title"><div className="login-card"><p className="eyebrow">员工访问</p><h2 id="login-title">登录运维工作台</h2><p className="muted">使用 MedicalCareWeb 员工账号继续。</p>
      <form noValidate onSubmit={submit} onKeyDown={(event) => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }}>
        <div className="field"><label htmlFor="email">员工邮箱</label><input ref={emailRef} id="email" type="email" autoComplete="username" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby="email-error" /><span id="email-error" className="field-error">{errors.email}</span></div>
        <div className="field"><label htmlFor="password">密码</label><div className="password-field"><input ref={passwordRef} id="password" type={visible ? "text" : "password"} autoComplete="current-password" maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={Boolean(errors.password)} aria-describedby="password-error" /><button className="show-password" type="button" aria-label={visible ? "隐藏密码" : "显示密码"} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? "隐藏" : "显示"}</button></div><span id="password-error" className="field-error">{errors.password}</span></div>
        <div className="form-feedback">{error && <Notice error>{error}</Notice>}</div><Button type="submit" className="primary full-width" busy={busy}>登录工作台 <span aria-hidden="true">→</span></Button>
      </form><div className="access-note"><strong>访问范围由运维授权决定</strong><p>如无法登录或需要调整环境权限，请联系平台管理员。</p></div>
    </div><p className="login-footer">MedicalCare Health · 运维人员专用</p></section>
  </main>;
}
