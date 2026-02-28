"use client";
import { useState } from "react";

export type ToastItem = { id: string; title: string; desc?: string };

export function ToastHost({ items }: { items: ToastItem[] }) {
  return (
    <div className="toastWrap">
      {items.map((t) => (
        <div key={t.id} className="toast">
          <div className="t">{t.title}</div>
          {t.desc ? <div className="d">{t.desc}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function useToasts() {
  const [items, setItems] = useState<ToastItem[]>([]);
  function push(title: string, desc?: string) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setItems((x) => [{ id, title, desc }, ...x].slice(0, 4));
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3200);
  }
  return { items, push };
}
