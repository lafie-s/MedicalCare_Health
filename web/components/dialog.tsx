"use client";
import { useEffect, useRef, type ReactNode } from "react";
export function Dialog({ title, children, onCancel }: { title: string; children: ReactNode; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef(onCancel); cancel.current = onCancel;
  useEffect(() => { const dialog = ref.current!; const previous = document.activeElement as HTMLElement | null; dialog.showModal(); return () => { dialog.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); cancel.current(); }}><h2 id="dialog-title">{title}</h2>{children}</dialog>;
}
