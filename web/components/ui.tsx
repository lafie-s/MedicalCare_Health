import type { ButtonHTMLAttributes, ReactNode } from "react";
export function Button({ busy = false, children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return <button {...props} disabled={props.disabled || busy} aria-busy={busy} className={`button ${className}`}><span style={{ visibility: busy ? "hidden" : "visible" }}>{children}</span>{busy && <span className="button-busy">处理中…</span>}</button>;
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`notice ${error ? "notice-error" : ""}`} role={error ? "alert" : "status"}>{children}</div>;
}
export function Brand() {
  return <div className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>MedicalCare <strong>Health</strong></span></div>;
}
