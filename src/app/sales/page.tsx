"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import PushButtons from "@/components/PushButtons";
import { notify } from "@/lib/notify";
import PushInit from "@/components/PushInit";

const CATEGORIES = [
  "Phones",
  "Accessories",
  "Wish Money",
  "Repair",
  "Services",
  "Other",
] as const;

type Category = (typeof CATEGORIES)[number];
type PayType = "cash" | "debt" | "payout";

type CatalogItem = { name: string; price: number };
type Catalog = Record<Category, CatalogItem[]>;

type CartItem = { name: string; price: number; qty: number };

type SaleRow = {
  id: string;
  created_at: string;
  category: string;
  amount: number;
  pay_type: PayType;
  note: string | null;
  items: any;
  deleted_at?: string | null;
};

const LS_CATALOG_KEY = "mokhtar_pos_catalog_v1";

function money(n: number) {
  return  `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

function defaultCatalog(): Catalog {
  return {
    Phones: [],
    Accessories: [{ name: "Cover", price: 5 }],
    "Wish Money": [
      { name: "Receive", price: 0 },
      { name: "Transfer", price: 0 },
    ],
    Repair: [
      { name: "Screen", price: 0 },
      { name: "Battery", price: 0 },
      { name: "Software", price: 0 },
    ],
    Services: [
      { name: "OSN", price: 0 },
      { name: "Netflix", price: 0 },
      { name: "ChatGPT", price: 0 },
    ],
    Other: [],
  };
}

function loadCatalog(): Catalog {
  try {
    const raw = localStorage.getItem(LS_CATALOG_KEY);
    if (!raw) return defaultCatalog();
    const parsed = JSON.parse(raw);
    const base = defaultCatalog();
    for (const k of CATEGORIES) {
      const v = parsed?.[k];
      if (Array.isArray(v)) {
        base[k] = v
          .map((x: any) => ({ name: String(x?.name ?? "").trim(), price: Number(x?.price ?? 0) }))
          .filter((x: CatalogItem) => x.name.length > 0);
      }
    }
    return base;
  } catch {
    return defaultCatalog();
  }
}

function saveCatalog(catalog: Catalog) {
  localStorage.setItem(LS_CATALOG_KEY, JSON.stringify(catalog));
}

export default function SalesPage() {
  const [category, setCategory] = useState<Category>("Phones");
  const [payType, setPayType] = useState<PayType>("cash");

  const [catalog, setCatalog] = useState<Catalog>(() => defaultCatalog());
  const [isManageOpen, setIsManageOpen] = useState(false);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [note, setNote] = useState("");

  // payout (amount-only)
  const [payoutAmount, setPayoutAmount] = useState<string>("");

  // custom item add
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState<string>("");
  const customNameRef = useRef<HTMLInputElement | null>(null);

  // debt fields
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [dueAt, setDueAt] = useState<string>(""); // datetime-local

  // latest sales
  const [latest, setLatest] = useState<SaleRow[]>([]);
  const [cashBalance, setCashBalance] = useState<number>(0);
  const [cashInToday, setCashInToday] = useState<number>(0);
  const [cashOutToday, setCashOutToday] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setCatalog(loadCatalog());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // payout is amount-only and should not keep cart items
    if (payType === "payout") setCart([]);
  }, [payType]);

  const categoryItems = useMemo(() => catalog[category] ?? [], [catalog, category]);
  const total = useMemo(
    () => cart.reduce((s, it) => s + (Number.isFinite(it.price) ? it.price : 0) * (it.qty || 0), 0),
    [cart]
  );

  function startOfTodayISO() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  async function refreshCashMetrics() {
    try {
      const { data, error } = await supabase
        .from("sales")
        .select("amount,pay_type,created_at")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;

      const rows = (data ?? []) as any[];
      const cashIn = rows.filter((r) => r.pay_type === "cash").reduce((a, r) => a + Number(r.amount || 0), 0);
      const cashOut = rows.filter((r) => r.pay_type === "payout").reduce((a, r) => a + Number(r.amount || 0), 0);
      setCashBalance(cashIn - cashOut);

      const startISO = startOfTodayISO();
      const today = rows.filter((r) => (r.created_at || "") >= startISO);
      const tIn = today.filter((r) => r.pay_type === "cash").reduce((a, r) => a + Number(r.amount || 0), 0);
      const tOut = today.filter((r) => r.pay_type === "payout").reduce((a, r) => a + Number(r.amount || 0), 0);
      setCashInToday(tIn);
      setCashOutToday(tOut);
    } catch {
      // ignore metrics failures
    }
  }

  async function refreshLatest() {
    const { data, error } = await supabase
      .from("sales")
      .select("id,created_at,category,amount,pay_type,note,items,deleted_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) {
      setErr(error.message);
      return;
    }
    setLatest((data ?? []) as any);
    refreshCashMetrics();
  }

  useEffect(() => {
    refreshLatest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addToCart(name: string, price: number) {
    setCart((prev) => {
      const idx = prev.findIndex((x) => x.name.toLowerCase() === name.toLowerCase());
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { name, price, qty: 1 }];
    });
  }

  function updateCart(i: number, patch: Partial<CartItem>) {
    setCart((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      if (next[i].qty <= 0) next.splice(i, 1);
      return next;
    });
  }

  function removeCart(i: number) {
    setCart((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addCustom() {
    const name = customName.trim();
    const price = Number(customPrice);
    if (!name) return;
    addToCart(name, Number.isFinite(price) ? price : 0);
    setCustomName("");
    setCustomPrice("");
    customNameRef.current?.focus();
  }

  async function onPay() {
    setErr(null);
    setLoading(true);

    try {
      // payout: amount-only
      if (payType === "payout") {
        const amt = Number(payoutAmount);
        if (!Number.isFinite(amt) || amt <= 0) {
          setErr("Enter a payout amount.");
          return;
        }
        const { error } = await supabase.from("sales").insert({
          category,
          amount: amt,
          pay_type: "payout",
          note: note.trim() || null,
          items: [],
        });
        if (error) throw error;

        // Notify owner
        notify("Payout (-)", `${money(amt)} • ${note.trim() || category}`);

        setPayoutAmount("");
        setNote("");
        await refreshLatest();
        return;
      }

      // cash/debt needs cart
      if (cart.length === 0) {
        setErr("Add at least 1 item.");
        return;
      }

      const itemsPayload = cart.map((x) => ({ name: x.name, price: x.price, qty: x.qty }));
      const amount = itemsPayload.reduce((s, x) => s + x.price * x.qty, 0);

      // If debt, require customer
      if (payType === "debt" && (!customerName.trim() || !customerPhone.trim())) {
        setErr("Debt requires customer name + phone.");
        return;
      }

      const { data: saleData, error: saleErr } = await supabase
        .from("sales")
        .insert({
          category,
          amount,
          pay_type: payType,
          note: note.trim() || null,
          items: itemsPayload,
        })
        .select("id")
        .single();
      if (saleErr) throw saleErr;
      const itemsText =
  itemsPayload?.length
    ? itemsPayload.map((x) => `${x.qty}x ${x.name}`).join(", ")
    : "";

const baseLine =
  `${category} • ${money(amount)}` +
  (itemsText ? ` • ${itemsText}` : "") +
  (note.trim() ? ` • Note: ${note.trim()}` : "");

// Owner notifications
if (payType === "cash") notify("Sale (+)", baseLine);
if (payType === "debt") notify("Debt (new)", `${customerName.trim()} • ${customerPhone.trim()} • ${baseLine}`);

      // Notify owner for every sale/debt creation
      if (payType === "cash") {
        notify(
          "Sale (+)",
          `${category} • ${money(amount)}${note.trim() ? ` • ${note.trim()}` : ""}`
        );
      }
      if (payType === "debt") {
        notify(
          "Debt (new)",
          `${customerName.trim()} • ${customerPhone.trim()} • ${money(amount)}${dueAt ? ` • Due: ${new Date(dueAt).toLocaleString()}` : ""}`
        );
      }

      // If debt: also create a debt record (pending)
      if (payType === "debt") {
        const dueISO = dueAt ? new Date(dueAt).toISOString() : null;
        const dueDate = dueAt ? dueAt.split("T")[0] : null;
        const { error: debtErr } = await supabase.from("debts").insert({
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          amount,
          paid_amount: 0,
          status: "pending",
          sale_id: saleData?.id ?? null,
          note: note.trim() || null,
          due_at: dueISO,
          due_date: dueDate,
        });
        if (debtErr) throw debtErr;
      }

      // Extra context notification for Wish Money (transfer/receive)
const isWishCategory = String(category).toLowerCase().includes("wish");
if (isWishCategory) {
  const hasTransfer = itemsPayload.some((x) => String(x.name).toLowerCase().includes("transfer"));
  const hasReceive = itemsPayload.some((x) => String(x.name).toLowerCase().includes("receive"));
  const wishLabel = hasTransfer ? "Wish Transfer" : hasReceive ? "Wish Receive" : "Wish";

  notify(wishLabel, baseLine);
}

      // reset
      setCart([]);
      setNote("");
      setCustomerName("");
      setCustomerPhone("");
      setDueAt("");
      await refreshLatest();
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally {
      setLoading(false);
    }
  }

  async function softDelete(id: string) {
    const ok = confirm("Delete this sale? (It will be hidden from totals)");
    if (!ok) return;
    const { error } = await supabase.from("sales").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      setErr(error.message);
      return;
    }
    notify("Sale deleted", `A sale was deleted (hidden from totals).`);
    await refreshLatest();
  }

  function openManage() {
    setIsManageOpen(true);
  }

  function saveManage(nextItems: CatalogItem[]) {
    const nextCatalog: Catalog = { ...catalog, [category]: nextItems };
    setCatalog(nextCatalog);
    saveCatalog(nextCatalog);
    setIsManageOpen(false);
  }

  return (
    <>
  <PushInit />
    <div className="page">
      <div className="header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1>Sales</h1>
            <div className="sub">
              <span style={{ fontWeight: 900 }}>Today:</span> {new Date().toLocaleDateString()} • USD • fast POS
            </div>
          </div>
          <div style={{ minWidth: 280 }}>
            <PushButtons compact />
          </div>
        </div>
      </div>

      <div className="grid metrics" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="muted">Cash balance</div>
          <div className="big">{money(cashBalance)}</div>
          <div className="tiny">cash in − payout</div>
        </div>
        <div className="card">
          <div className="muted">Cash in (today)</div>
          <div className="big">{money(cashInToday)}</div>
        </div>
        <div className="card">
          <div className="muted">Cash out (today)</div>
          <div className="big">{money(cashOutToday)}</div>
        </div>
      </div>

      {err ? <div className="toast error">{err}</div> : null}

      <div className="grid two">
        {/* LEFT */}
        <div className="card">
          <div className="sectionTitle">POS</div>

          {/* Pay controls (top-right) */}
          <div className="payTop">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className={`pill ${payType === "cash" ? "active" : ""}`} onClick={() => setPayType("cash")} type="button">
                Cash (+)
              </button>
              <button className={`pill ${payType === "debt" ? "active" : ""}`} onClick={() => setPayType("debt")} type="button">
                Debt
              </button>
              <button className={`pill ${payType === "payout" ? "active" : ""}`} onClick={() => setPayType("payout")} type="button">
                Payout (-)
              </button>
            </div>
            <div className="payTopRight">
              <div className="muted" style={{ fontWeight: 900, fontSize: 12 }}>Total</div>
              <div className="big" style={{ fontSize: 22 }}>{payType === "payout" ? money(Number(payoutAmount || 0)) : money(total)}</div>
              <button className="btn primary" type="button" onClick={onPay} disabled={loading}>
                {loading ? "Saving…" : payType === "payout" ? "SAVE" : "PAY"}
              </button>
            </div>
          </div>

          <div className="pillRow">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                className={`pill ${category === c ? "active" : ""}`}
                onClick={() => setCategory(c)}
                type="button"
              >
                {c}
              </button>
            ))}
          </div>

          <div className="divider" />

          {payType === "payout" ? (
            <div style={{ marginTop: 14 }}>
              <div className="row">
                <label className="label">Payout amount (USD)</label>
                <input
                  className="input"
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(e.target.value)}
                  placeholder="e.g. 20"
                />
              </div>
            </div>
          ) : (
            <>
              <div className="row" style={{ marginTop: 14, display: "flex", justifyContent: "space-between" }}>
                <div className="label">Tap item to add • edit prices in cart</div>
                <button className="link" type="button" onClick={openManage}>
                  Manage items
                </button>
              </div>

              <div className="pillRow" style={{ marginTop: 10 }}>
                {categoryItems.length === 0 ? (
                  <div className="muted">No quick items in this category.</div>
                ) : null}
                {categoryItems.map((it, idx) => (
                  <button
                    key={`${it.name}-${idx}`}
                    type="button"
                    className="pill"
                    onClick={() => addToCart(it.name, it.price)}
                  >
                    {it.name}
                    <span className="pillSub">{it.price ? money(it.price) : ""}</span>
                  </button>
                ))}
              </div>

              <div className="row" style={{ marginTop: 14 }}>
                <label className="label">Custom item</label>
                <div className="grid three" style={{ gap: 10 }}>
                  <input
                    ref={customNameRef}
                    className="input"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="Item name"
                  />
                  <input
                    className="input"
                    value={customPrice}
                    onChange={(e) => setCustomPrice(e.target.value)}
                    placeholder="Price (USD)"
                  />
                  <button className="btn" type="button" onClick={addCustom}>
                    Add
                  </button>
                </div>
              </div>

              <div className="divider" />

              <div className="sectionTitle" style={{ marginTop: 6 }}>
                Cart
              </div>

              {cart.length === 0 ? <div className="muted">No items yet.</div> : null}

              <div className="cart">
                {cart.map((it, i) => (
                  <div key={`${it.name}-${i}`} className="cartRow">
                    <div>
                      <div className="cartName">{it.name}</div>
                      <div className="cartSub">Line: {money(it.price * it.qty)}</div>
                    </div>

                    <div className="cartControls">
                      <div className="mini">
                        <span className="miniLabel">Qty</span>
                        <input
                          className="miniInput"
                          value={String(it.qty)}
                          onChange={(e) => updateCart(i, { qty: Number(e.target.value || 0) })}
                        />
                      </div>
                      <div className="mini">
                        <span className="miniLabel">Price</span>
                        <input
                          className="miniInput"
                          value={String(it.price)}
                          onChange={(e) => updateCart(i, { price: Number(e.target.value || 0) })}
                        />
                      </div>
                      <button className="btn danger" type="button" onClick={() => removeCart(i)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {payType === "debt" ? (
                <div style={{ marginTop: 12 }}>
                  <div className="sectionTitle">Debt details</div>
                  <div className="grid two" style={{ gap: 10 }}>
                    <input
                      className="input"
                      placeholder="Customer name"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                    />
                    <input
                      className="input"
                      placeholder="Customer phone"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                    />
                  </div>

                  <div className="row" style={{ marginTop: 10 }}>
                    <label className="label">Due date & time</label>
                    <input
                      className="input"
                      type="datetime-local"
                      value={dueAt}
                      onChange={(e) => setDueAt(e.target.value)}
                    />
                    <div className="muted" style={{ marginTop: 6 }}>
                      When due time arrives, you can send WhatsApp. (Auto push requires push setup.)
                    </div>
                  </div>
                </div>
              ) : null}

              <div style={{ marginTop: 12 }} className="row">
                <label className="label">Note (received / transfer / details)</label>
                <input
                  className="input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional"
                />
              </div>

              <div className="muted" style={{ marginTop: 10, fontWeight: 800 }}>
                Tip: Edit price directly in cart before Pay.
              </div>
            </>
          )}

          {payType === "payout" ? (
            <>
              <div style={{ marginTop: 12 }} className="row">
                <label className="label">Note (why payout?)</label>
                <input
                  className="input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional"
                />
              </div>

              <div className="muted" style={{ marginTop: 10, fontWeight: 800 }}>
                Payout will reduce cash balance.
              </div>
            </>
          ) : null}
        </div>

        {/* RIGHT */}
        <div className="card">
          <div className="sectionTitle">Latest sales</div>
          <div className="muted">Deletes are soft (hidden from totals).</div>

          <div style={{ marginTop: 10 }}>
            {latest.length === 0 ? <div className="muted">No sales yet.</div> : null}
            {latest.map((s) => (
              <div key={s.id} className="saleRow">
                <div>
                  <div className="saleTitle">
                    {s.category} • {s.pay_type.toUpperCase()}
                  </div>
                  <div className="saleSub">
                    {new Date(s.created_at).toLocaleString()} {s.note ? `• ${s.note}` : ""}
                  </div>
                </div>
                <div className="saleRight">
                  <div className="big">{money(s.amount)}</div>
                  <button className="btn danger" type="button" onClick={() => softDelete(s.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    
      
      {isManageOpen ? (
        <ManageModal
          category={category}
          items={categoryItems}
          onClose={() => setIsManageOpen(false)}
          onSave={saveManage}
        />
      ) : null}
      </div>   
      <style jsx>{`
        .grid { display: grid; gap: 14px; }
        .grid.two { grid-template-columns: 1.2fr 0.8fr; }
        .grid.three { grid-template-columns: 1.4fr 0.8fr 0.6fr; }
        .grid.metrics { grid-template-columns: repeat(3, 1fr); }
        .divider { height: 1px; background: rgba(255,255,255,0.08); margin: 14px 0; }
        .row { margin-top: 10px; }
        .label { display:block; font-size: 12px; color: rgba(255,255,255,0.65); margin-bottom: 6px; }
        .input { width: 100%; padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); color: white; }
        .btn { padding: 10px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.06); color: white; cursor: pointer; }
        .btn.primary { background: linear-gradient(90deg, rgba(246,196,83,0.95), rgba(212,161,42,0.95)); border-color: rgba(246,196,83,0.35); color: #1a1306; }
        .btn.danger { background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.35); }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .link { background: transparent; border: none; color: rgba(246,196,83,1); cursor: pointer; font-weight: 900; }
        .pillRow { display:flex; flex-wrap: wrap; gap: 10px; }
        .pill { padding: 10px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.04); color: white; cursor:pointer; }
        .pill.active { background: rgba(246,196,83,0.14); border-color: rgba(246,196,83,0.35); }
        .payTop { display:flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 10px; padding: 12px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.10); background: rgba(0,0,0,0.18); }
        .payTopRight { display:flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
        .pillSub { margin-left: 8px; opacity: 0.65; font-size: 12px; }
        .muted { color: rgba(255,255,255,0.55); font-size: 13px; }
        .big { font-size: 20px; font-weight: 700; }
        .cart { margin-top: 10px; display:flex; flex-direction: column; gap: 10px; }
        .cartRow { display:flex; justify-content: space-between; gap: 12px; padding: 12px; border-radius: 16px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
        .cartName { font-weight: 700; }
        .cartSub { font-size: 12px; opacity: 0.7; margin-top: 2px; }
        .cartControls { display:flex; align-items: center; gap: 10px; }
        .mini { display:flex; align-items: center; gap: 8px; }
        .miniLabel { font-size: 12px; opacity: 0.65; }
        .miniInput { width: 70px; padding: 8px 10px; border-radius: 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); color: white; }
        .payBar { margin-top: 14px; display:flex; justify-content: space-between; align-items: center; padding: 14px; border-radius: 18px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
        .saleRow { display:flex; justify-content: space-between; align-items:flex-start; gap: 12px; padding: 12px; border-radius: 16px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); margin-top: 10px; }
        .saleTitle { font-weight: 700; }
        .saleSub { font-size: 12px; opacity: 0.7; margin-top: 2px; }
        .saleRight { display:flex; flex-direction: column; align-items:flex-end; gap: 8px; }
        .toast.error { margin: 10px 0; padding: 10px 12px; border-radius: 14px; background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.35); }
      `}</style>
   
    </>
  );
}

function ManageModal({
  category,
  items,
  onClose,
  onSave,
}: {
  category: Category;
  items: CatalogItem[];
  onClose: () => void;
  onSave: (items: CatalogItem[]) => void;
}) {
  const [rows, setRows] = useState<CatalogItem[]>(() => items.map((x) => ({ ...x })));

  function updateRow(i: number, patch: Partial<CatalogItem>) {
    setRows((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }

  function addRow() {
    setRows((prev) => [...prev, { name: "", price: 0 }]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function save() {
    onSave(
      rows
        .map((x) => ({ name: x.name.trim(), price: Number(x.price || 0) }))
        .filter((x) => x.name.length > 0)
    );
  }

  return (
    <div className="modalWrap" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <div className="modalTitle">Manage items</div>
            <div className="modalSub">Category: {category}</div>
          </div>
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modalBody">
          {rows.length === 0 ? <div className="muted">No items yet.</div> : null}
          {rows.map((r, i) => (
            <div key={i} className="manageRow">
              <input
                className="input"
                placeholder="Item name"
                value={r.name}
                onChange={(e) => updateRow(i, { name: e.target.value })}
              />
              <input
                className="input"
                placeholder="Price"
                value={String(r.price)}
                onChange={(e) => updateRow(i, { price: Number(e.target.value || 0) })}
              />
              <button className="btn danger" type="button" onClick={() => removeRow(i)}>
                Delete
              </button>
            </div>
          ))}
        </div>

        <div className="modalFooter">
          <button className="btn" type="button" onClick={addRow}>
            Add item
          </button>
          <button className="btn primary" type="button" onClick={save}>
            Save
          </button>
        </div>
      </div>

      <style jsx>{`
        .modalWrap {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 50;
        }
        .modal {
          width: min(900px, 100%);
          border-radius: 20px;
          background: rgba(15, 23, 42, 0.92);
          border: 1px solid rgba(255,255,255,0.10);
          box-shadow: 0 24px 60px rgba(0,0,0,0.45);
          padding: 16px;
        }
        .modalHeader { display:flex; justify-content: space-between; align-items: center; gap: 12px; }
        .modalTitle { font-size: 18px; font-weight: 800; }
        .modalSub { font-size: 12px; opacity: 0.7; margin-top: 2px; }
        .modalBody { margin-top: 14px; display:flex; flex-direction: column; gap: 10px; }
        .manageRow { display:grid; grid-template-columns: 1.4fr 0.6fr 0.4fr; gap: 10px; }
        .modalFooter { margin-top: 14px; display:flex; justify-content: space-between; }
        .input { width: 100%; padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); color: white; }
        .btn { padding: 10px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.06); color: white; cursor: pointer; }
        .btn.primary { background: linear-gradient(90deg, rgba(59,130,246,0.9), rgba(37,99,235,0.9)); border-color: rgba(59,130,246,0.35); }
        .btn.danger { background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.35); }
        .muted { color: rgba(255,255,255,0.55); font-size: 13px; }
      `}</style>
    </div>
  
  );
}
