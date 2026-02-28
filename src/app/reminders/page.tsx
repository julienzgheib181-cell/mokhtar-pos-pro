"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type DebtRow = {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  amount: number;
  due_date: string | null;
  status: "pending" | "paid" | string;
  whatsapp_text: string | null;
  created_at: string;
  paid_at?: string | null;
};

function isDueSoon(dueDate: string | null) {
  if (!dueDate) return false;
  const d = new Date(dueDate + "T00:00:00");
  const now = new Date();
  const diffDays = Math.floor((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays <= 2;
}

function formatPhone(p?: string | null) {
  if (!p) return "";
  return p.replace(/\s+/g, "");
}

export default function RemindersPage() {
  const [rows, setRows] = useState<DebtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from("debts")
      .select("id,customer_name,customer_phone,amount,due_date,status,whatsapp_text,created_at,paid_at")
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setRows((data ?? []) as DebtRow[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const pending = useMemo(() => rows.filter((r) => r.status === "pending"), [rows]);
  const paid = useMemo(() => rows.filter((r) => r.status === "paid"), [rows]);
  const dueSoon = useMemo(() => pending.filter((r) => isDueSoon(r.due_date)), [pending]);

  async function markPaid(id: string) {
    setError(null);
    const { error } = await supabase.from("debts").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    setToast("Marked as PAID");
    setTimeout(() => setToast(null), 1400);
    await load();
  }

  async function markPending(id: string) {
    setError(null);
    const { error } = await supabase.from("debts").update({ status: "pending", paid_at: null }).eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    setToast("Moved to PENDING");
    setTimeout(() => setToast(null), 1400);
    await load();
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Copied!");
      setTimeout(() => setToast(null), 1400);
    } catch {
      setToast("Copy failed (browser blocked)");
      setTimeout(() => setToast(null), 1400);
    }
  }

  function buildWhatsAppLink(phone: string | null, text: string) {
    const p = formatPhone(phone);
    const t = encodeURIComponent(text);
    return p ? `https://wa.me/${p}?text=${t}` : `https://wa.me/?text=${t}`;
  }

  function Badge({ txt, kind }: { txt: string; kind: "warn" | "ok" | "muted" }) {
    const bg = kind === "warn" ? "rgba(255,165,0,.15)" : kind === "ok" ? "rgba(0,255,160,.12)" : "rgba(255,255,255,.06)";
    const bd = kind === "warn" ? "rgba(255,165,0,.35)" : kind === "ok" ? "rgba(0,255,160,.25)" : "rgba(255,255,255,.12)";
    return (
      <span style={{ padding: "4px 8px", borderRadius: 999, background: bg, border: `1px solid ${bd}`, fontSize: 12, fontWeight: 800 }}>
        {txt}
      </span>
    );
  }

  function DebtCard({ d, showPaidActions }: { d: DebtRow; showPaidActions?: boolean }) {
    const dueSoonFlag = d.status === "pending" && isDueSoon(d.due_date);
    const wa = d.whatsapp_text || "";
    return (
      <div className="card" style={{ background: "rgba(0,0,0,.12)", border: dueSoonFlag ? "1px solid rgba(255,165,0,.35)" : undefined }}>
        <div className="bd" style={{ padding: 12, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 950 }}>{d.customer_name}</div>
              {d.status === "pending" ? <Badge txt="PENDING" kind={dueSoonFlag ? "warn" : "muted"} /> : <Badge txt="PAID" kind="ok" />}
              {dueSoonFlag && <Badge txt="DUE SOON" kind="warn" />}
            </div>
            <div className="muted" style={{ fontWeight: 700, marginTop: 6 }}>
              {d.customer_phone || "No phone"} • Due: {d.due_date || "—"}
              {d.status === "paid" && d.paid_at ? ` • Paid: ${new Date(d.paid_at).toLocaleString()}` : ""}
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
               <button className="pill" onClick={() => copyText(wa)} disabled={!wa}>
                Copy WhatsApp
             </button>
             <button
  className="btn"
  onClick={() => {
    let p = (d.customer_phone || "").replace(/\D/g, "");
    if (p.startsWith("0")) p = "961" + p.slice(1);

    const msg = encodeURIComponent(
  d.whatsapp_text ||
  `مرحبا ${d.customer_name} 👋\n\nمعك Mokhtar Cell 📱\n\nعليك مبلغ $${d.amount} مستحق بتاريخ ${d.due_date || "-"}.\n\nفيك تمر لعنا أو تبعت المبلغ بأقرب وقت 🙏\n\nشكراً لإلك ❤️`
);

    const url = `https://wa.me/${p}?text=${msg}`;
window.open(url, "_blank");
  }}
>
  Open WhatsApp
</button>
              {d.status === "pending" && (
                <button className="btn" onClick={() => markPaid(d.id)}>
                  Mark PAID
                </button>
              )}
              {showPaidActions && d.status === "paid" && (
                <button className="pill" onClick={() => markPending(d.id)}>
                  Move to PENDING
                </button>
              )}
            </div>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 950, fontSize: 18 }}>${Number(d.amount || 0).toFixed(2)}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingTop: 16 }}>
      <div className="card" style={{ background: "linear-gradient(135deg, rgba(30,144,255,.16), rgba(0,0,0,.12))" }}>
        <div className="bd" style={{ padding: 14, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 950, fontSize: 16 }}>Reminders</div>
            <div className="muted" style={{ fontWeight: 700, marginTop: 2 }}>Pending / Paid debts • WhatsApp message • due date</div>
          </div>
          <button className="btn" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      {toast && (
        <div className="card" style={{ marginTop: 12, border: "1px solid rgba(0,255,160,.25)", background: "rgba(0,255,160,.08)" }}>
          <div className="bd" style={{ padding: 12, fontWeight: 800 }}>{toast}</div>
        </div>
      )}

      {error && (
        <div className="card" style={{ marginTop: 12, border: "1px solid rgba(255,80,80,.35)", background: "rgba(255,80,80,.08)" }}>
          <div className="bd" style={{ padding: 12, fontWeight: 800 }}>{error}</div>
        </div>
      )}

      <div className="grid" style={{ marginTop: 12, gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="card">
          <div className="hd">Due soon (≤ 2 days)</div>
          <div className="bd">
            {loading ? (
              <div className="muted" style={{ fontWeight: 800 }}>Loading…</div>
            ) : dueSoon.length === 0 ? (
              <div className="muted" style={{ fontWeight: 800 }}>No due-soon debts.</div>
            ) : (
              <div className="grid" style={{ gap: 10 }}>{dueSoon.map((d) => <DebtCard key={d.id} d={d} />)}</div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="hd">Pending</div>
          <div className="bd">
            {loading ? (
              <div className="muted" style={{ fontWeight: 800 }}>Loading…</div>
            ) : pending.length === 0 ? (
              <div className="muted" style={{ fontWeight: 800 }}>No pending debts.</div>
            ) : (
              <div className="grid" style={{ gap: 10 }}>{pending.map((d) => <DebtCard key={d.id} d={d} />)}</div>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="hd">Paid</div>
        <div className="bd">
          {loading ? (
            <div className="muted" style={{ fontWeight: 800 }}>Loading…</div>
          ) : paid.length === 0 ? (
            <div className="muted" style={{ fontWeight: 800 }}>No paid debts.</div>
          ) : (
            <div className="grid" style={{ gap: 10 }}>{paid.slice(0, 30).map((d) => <DebtCard key={d.id} d={d} showPaidActions />)}</div>
          )}
        </div>
      </div>

      <div className="muted" style={{ marginTop: 12, fontWeight: 800, fontSize: 12 }}>
        If you don’t have columns like <b>whatsapp_text</b> or <b>due_date</b>, run the SQL in README.
      </div>
    </div>
  );
}
