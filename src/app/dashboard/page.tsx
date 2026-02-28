"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { ToastHost, useToasts } from "@/components/Toast";

function money(n: number) { return `$${n.toFixed(2)}`; }
function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function startOfMonth(d = new Date()) { const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }

export default function DashboardPage() {
  const { items: toasts, push } = useToasts();
  const [rows, setRows] = useState<any[]>([]);
  const [pendingDebts, setPendingDebts] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("sales")
        .select("id,created_at,amount,pay_type,category,note,deleted_at")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      setRows(data ?? []);

      const { data: debts, error: debtErr } = await supabase
        .from('debts')
        .select('amount,status')
        .eq('status', 'pending');
      if (debtErr) throw debtErr;
      const p = (debts ?? []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
      setPendingDebts(p);
    } catch (e:any) {
      push("Dashboard", "Create Supabase table `sales` + env vars, then refresh.");
      setRows([]);
      setPendingDebts(0);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const now = new Date();
  const day0 = startOfDay(now).getTime();
  const month0 = startOfMonth(now).getTime();

  const today = useMemo(() => rows.filter(r => new Date(r.created_at).getTime() >= day0), [rows, day0]);
  const month = useMemo(() => rows.filter(r => new Date(r.created_at).getTime() >= month0), [rows, month0]);

  const sum = (arr:any[], pred:(r:any)=>boolean) => arr.filter(pred).reduce((s,r)=> s + Number(r.amount||0), 0);

  const todaySales = useMemo(() => sum(today, r => r.pay_type === "cash" || r.pay_type === "debt"), [today]);
  const monthSales = useMemo(() => sum(month, r => r.pay_type === "cash" || r.pay_type === "debt"), [month]);
  const cashInToday = useMemo(() => sum(today, r => r.pay_type === "cash"), [today]);
  const debtToday = useMemo(() => sum(today, r => r.pay_type === "debt"), [today]);
  const payoutToday = useMemo(() => sum(today, r => r.pay_type === "payout"), [today]);

  const cashInAll = useMemo(() => sum(rows, r => r.pay_type === 'cash'), [rows]);
  const cashOutAll = useMemo(() => sum(rows, r => r.pay_type === 'payout'), [rows]);
  const cashBalance = useMemo(() => cashInAll - cashOutAll, [cashInAll, cashOutAll]);

  return (
    <div className="container" style={{ paddingTop: 16 }}>
      <ToastHost items={toasts} />

      <div className="grid" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
        <div className="card"><div className="hd">Today Sales</div><div className="bd"><div className="kpi"><div><div className="val">{money(todaySales)}</div><div className="sub">cash + debt</div></div></div></div></div>
        <div className="card"><div className="hd">This Month</div><div className="bd"><div className="kpi"><div><div className="val">{money(monthSales)}</div><div className="sub">cash + debt</div></div></div></div></div>
        <div className="card"><div className="hd">Cash In</div><div className="bd"><div className="kpi"><div><div className="val">{money(cashInToday)}</div><div className="sub">today</div></div></div></div></div>
        <div className="card"><div className="hd">Debt Created</div><div className="bd"><div className="kpi"><div><div className="val">{money(debtToday)}</div><div className="sub">today</div></div></div></div></div>
        <div className="card"><div className="hd">Payout (-cash)</div><div className="bd"><div className="kpi"><div><div className="val">{money(payoutToday)}</div><div className="sub">today</div></div></div></div></div>
        <div className="card"><div className="hd">Cash Balance</div><div className="bd"><div className="kpi"><div><div className="val">{money(cashBalance)}</div><div className="sub">all time</div></div></div></div></div>
      </div>

      <div style={{ marginTop: 12 }} className="grid">
        <div className="card" style={{ maxWidth: 360 }}>
          <div className="hd">Pending Debts</div>
          <div className="bd"><div className="kpi"><div><div className="val">{money(pendingDebts)}</div><div className="sub">from Debts page</div></div></div></div>
        </div>
      </div>

      <div style={{ marginTop: 16 }} className="card">
        <div className="hd">Recent Activity</div>
        <div className="bd">
          {loading ? (
            <div className="muted" style={{ fontWeight: 700 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div className="muted" style={{ fontWeight: 700 }}>
              No data yet. Go to <a href="/sales" className="pill">Sales</a> and create your first sale.
            </div>
          ) : (
            <div className="grid" style={{ gap: 10 }}>
              {rows.slice(0, 12).map((r) => (
                <div key={r.id} className="card" style={{ background: "rgba(0,0,0,.12)" }}>
                  <div className="bd" style={{ padding: 12, display:"flex", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
                    <div>
                      <div style={{ fontWeight: 900 }}>{r.category} • {String(r.pay_type).toUpperCase()}</div>
                      <div className="muted" style={{ fontWeight: 700, marginTop: 4 }}>{r.note || "—"}</div>
                      <div className="muted" style={{ fontWeight: 700, marginTop: 4, fontSize: 12 }}>
                        {new Date(r.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div style={{ fontWeight: 950, fontSize: 18 }}>{money(Number(r.amount || 0))}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="sep" />
          <button className="btn" onClick={load}>Refresh</button>
        </div>
      </div>
    </div>
  );
}
