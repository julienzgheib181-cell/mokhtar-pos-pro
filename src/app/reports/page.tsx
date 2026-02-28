"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type SaleRow = {
  id: string;
  created_at: string;
  category: string;
  amount: number;
  pay_type: "cash" | "debt" | "payout";
  note: string | null;
  deleted_at?: string | null;
};

type DebtRow = {
  id: string;
  created_at: string;
  customer_name: string;
  customer_phone: string;
  amount: number;
  paid_amount: number;
  status: string;
};

function money(n: number) {
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfMonthISO() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function fmtDateTime(d?: string | null) {
  if (!d) return "-";
  const dt = new Date(d);
  const day = String(dt.getDate()).padStart(2, "0");
  const mon = String(dt.getMonth() + 1).padStart(2, "0");
  const yr = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${day}/${mon}/${yr} ${hh}:${mm}`;
}

export default function ReportsPage() {
  const [range, setRange] = useState<"today" | "month">("today");
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [debts, setDebts] = useState<DebtRow[]>([]);
  const [cashBalanceAll, setCashBalanceAll] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const since = useMemo(() => (range === "today" ? startOfTodayISO() : startOfMonthISO()), [range]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // Cash balance (all time): cash in - payout
      const { data: balData, error: balErr } = await supabase
        .from("sales")
        .select("amount,pay_type")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (balErr) throw balErr;
      const cashInAll = (balData ?? [])
        .filter((r: any) => r.pay_type === "cash")
        .reduce((a: number, r: any) => a + Number(r.amount || 0), 0);
      const cashOutAll = (balData ?? [])
        .filter((r: any) => r.pay_type === "payout")
        .reduce((a: number, r: any) => a + Number(r.amount || 0), 0);
      setCashBalanceAll(cashInAll - cashOutAll);

      const { data: sData, error: sErr } = await supabase
        .from("sales")
        .select("id,created_at,category,amount,pay_type,note,deleted_at")
        .is("deleted_at", null)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (sErr) throw sErr;
      setSales((sData ?? []) as any);

      const { data: dData, error: dErr } = await supabase
        .from("debts")
        .select("id,created_at,customer_name,customer_phone,amount,paid_amount,status")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (dErr) throw dErr;
      setDebts((dData ?? []) as any);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const running = useMemo(() => {
    // Running cash balance within selected range
    const asc = [...sales].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    let bal = 0;
    const map = new Map<string, number>();
    for (const s of asc) {
      if (s.pay_type === "cash") bal += s.amount || 0;
      if (s.pay_type === "payout") bal -= s.amount || 0;
      map.set(s.id, bal);
    }
    return map;
  }, [sales]);

  const cashIn = useMemo(
    () => sales.filter((s) => s.pay_type === "cash").reduce((a, s) => a + s.amount, 0),
    [sales]
  );
  const cashOut = useMemo(
    () => sales.filter((s) => s.pay_type === "payout").reduce((a, s) => a + s.amount, 0),
    [sales]
  );
  const netCash = cashIn - cashOut;
  const debtCreated = useMemo(
    () => sales.filter((s) => s.pay_type === "debt").reduce((a, s) => a + s.amount, 0),
    [sales]
  );

  const pendingDebt = useMemo(() => {
    return debts
      .filter((d) => (d.status || "pending") === "pending")
      .reduce((a, d) => a + Math.max(0, (d.amount ?? 0) - (d.paid_amount ?? 0)), 0);
  }, [debts]);

  return (
    <div className="page">
      <div className="header">
        <h1>Reports</h1>
        <div className="sub">Totals, cash in/out, and debts</div>
      </div>

      {error ? <div className="toast error">{error}</div> : null}

      <div className="pillRow">
        <button className={`pill ${range === "today" ? "active" : ""}`} onClick={() => setRange("today")}>
          Today
        </button>
        <button className={`pill ${range === "month" ? "active" : ""}`} onClick={() => setRange("month")}>
          This month
        </button>
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div className="grid four" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="muted">Cash balance (all time)</div>
          <div className="big">{money(cashBalanceAll)}</div>
          <div className="tiny">cash in − payout</div>
        </div>
        <div className="card">
          <div className="muted">Cash in</div>
          <div className="big">{money(cashIn)}</div>
        </div>
        <div className="card">
          <div className="muted">Cash out (payout)</div>
          <div className="big">{money(cashOut)}</div>
        </div>
        <div className="card">
          <div className="muted">Net cash</div>
          <div className="big">{money(netCash)}</div>
        </div>
      </div>

      <div className="grid two" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="muted">Debt created (from sales)</div>
          <div className="big">{money(debtCreated)}</div>
          <div style={{ marginTop: 10 }} className="muted">
            Pending debt total: <b>{money(pendingDebt)}</b>
          </div>
        </div>
        <div className="card">
          <div className="sectionTitle">Recent activity</div>
          {sales.slice(0, 20).map((s) => (
            <div key={s.id} className="saleRow">
              <div>
                <div className="saleTitle">
                  {s.category} • {s.pay_type.toUpperCase()}
                </div>
                <div className="saleSub">
                  {fmtDateTime(s.created_at)} • balance after: <b>{money(running.get(s.id) ?? 0)}</b>
                </div>
              </div>
              <div className="big">{money(s.amount)}</div>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        .grid.two { grid-template-columns: 1fr 1fr; }
        .grid.four { grid-template-columns: repeat(4, 1fr); }
        .pillRow { display:flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .pill { padding: 10px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.04); color: white; cursor:pointer; }
        .pill.active { background: rgba(59,130,246,0.18); border-color: rgba(59,130,246,0.35); }
        .btn { padding: 10px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.06); color: white; cursor: pointer; }
        .muted { color: rgba(255,255,255,0.55); font-size: 13px; }
        .tiny { color: rgba(255,255,255,0.55); font-size: 12px; margin-top: 4px; }
        .big { font-size: 20px; font-weight: 800; }
        .saleRow { display:flex; justify-content: space-between; align-items:center; gap: 12px; padding: 10px 12px; border-radius: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); margin-top: 10px; }
        .saleTitle { font-weight: 800; }
        .saleSub { font-size: 12px; opacity: 0.7; margin-top: 2px; }
        .toast.error { margin: 10px 0; padding: 10px 12px; border-radius: 14px; background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.35); }
      `}</style>
    </div>
  );
}
