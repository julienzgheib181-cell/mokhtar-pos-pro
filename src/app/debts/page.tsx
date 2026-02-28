'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { notify } from '@/lib/notify';

type DebtRow = {
  id: string;
  created_at: string;
  customer_name: string;
  customer_phone: string | null;
  amount: number;
  due_date: string | null;
  status: 'pending' | 'paid' | string;
  paid_at: string | null;
  paid_amount: number | null;
  due_at?: string | null;
};

function fmtDate(d?: string | null) {
  if (!d) return '-';
  const dt = new Date(d);
  const day = String(dt.getDate()).padStart(2, '0');
  const mon = String(dt.getMonth() + 1).padStart(2, '0');
  const yr = dt.getFullYear();
  return `${day}/${mon}/${yr}`;
}

function fmtDateTime(d?: string | null) {
  if (!d) return '-';
  const dt = new Date(d);
  const day = String(dt.getDate()).padStart(2, '0');
  const mon = String(dt.getMonth() + 1).padStart(2, '0');
  const yr = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${day}/${mon}/${yr} ${hh}:${mm}`;
}

function clsx(...v: Array<string | false | null | undefined>) {
  return v.filter(Boolean).join(' ');
}

export default function DebtsPage() {
  const [rows, setRows] = useState<DebtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pendingTotal = useMemo(
    () => rows.filter((r) => r.status === 'pending').reduce((a, r) => a + Number(r.amount || 0), 0),
    [rows]
  );

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('debts')
      .select('id,created_at,customer_name,customer_phone,amount,due_date,due_at,status,paid_at,paid_amount')
      .order('created_at', { ascending: false });

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

  async function markPaid(debt: DebtRow) {
    const paidAmount = debt.amount;
    const now = new Date().toISOString();

    const { error } = await supabase
      .from('debts')
      .update({ status: 'paid', paid_at: now, paid_amount: paidAmount })
      .eq('id', debt.id);

    if (error) {
      setError(error.message);
      return;
    }

    // Optional: record the payment as a cash sale entry (so it appears in dashboard totals)
    await supabase.from('sales').insert({
      category: 'Debt Payment',
      amount: paidAmount,
      pay_type: 'cash',
      note: `Debt paid: ${debt.customer_name}${debt.customer_phone ? ' (' + debt.customer_phone + ')' : ''}`,
      items: [],
    });

    // Notify owner
    notify('Debt paid', `${debt.customer_name} • $${Number(paidAmount).toFixed(2)}`);

    await load();
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Debts</h1>
          <p className="text-sm text-white/60">Track pending & paid customer debts</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right">
          <div className="text-xs text-white/60">Pending total</div>
          <div className="text-2xl font-semibold">${pendingTotal.toFixed(2)}</div>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 shadow-lg overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="text-sm font-semibold">All debts</div>
          <button
            type="button"
            onClick={load}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80 hover:bg-white/10"
          >
            Refresh
          </button>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="text-sm text-white/60">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-white/60">No debts yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-white/60">
                  <tr className="border-b border-white/10">
                    <th className="px-2 py-2 text-left font-semibold">Customer</th>
                    <th className="px-2 py-2 text-left font-semibold">Phone</th>
                    <th className="px-2 py-2 text-right font-semibold">Amount</th>
                    <th className="px-2 py-2 text-left font-semibold">Created</th>
                    <th className="px-2 py-2 text-left font-semibold">Due</th>
                    <th className="px-2 py-2 text-left font-semibold">Status</th>
                    <th className="px-2 py-2 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => {
                    const isPending = d.status === 'pending';
                    return (
                      <tr key={d.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="px-2 py-2 whitespace-nowrap font-semibold">{d.customer_name}</td>
                        <td className="px-2 py-2 whitespace-nowrap text-white/80">{d.customer_phone || '-'}</td>
                        <td className="px-2 py-2 whitespace-nowrap text-right font-semibold">${Number(d.amount).toFixed(2)}</td>
                        <td className="px-2 py-2 whitespace-nowrap text-white/70">{fmtDateTime(d.created_at)}</td>
                        <td className="px-2 py-2 whitespace-nowrap text-white/70">{d.due_at ? fmtDateTime(d.due_at) : (d.due_date ? fmtDate(d.due_date) : '-')}</td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <span
                            className={clsx(
                              'inline-flex rounded-full border px-2 py-0.5 text-[11px] uppercase',
                              isPending
                                ? 'border-amber-400/30 bg-amber-500/10 text-amber-100'
                                : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
                            )}
                          >
                            {d.status}
                          </span>
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-right">
                          {isPending ? (
                            <button
                              type="button"
                              onClick={() => markPaid(d)}
                              className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-black hover:brightness-110"
                            >
                              Mark paid
                            </button>
                          ) : (
                            <span className="text-xs text-white/60">Paid {d.paid_at ? fmtDateTime(d.paid_at) : ''}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
