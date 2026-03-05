"use client";

export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import PushButtons from "@/components/PushButtons";
import { notify } from "@/lib/notify";
import PushInit from "@/components/PushInit";

/** POS categories (Wish + DebtOnMe are NOT here) */
const CATEGORIES = ["Phones", "Accessories", "Repair", "Services", "Other"] as const;

type PosCategory = (typeof CATEGORIES)[number];
type PayType = "cash" | "debt" | "payout";
type MainTab = "pos" | "wish" | "debtOnMe";

type CatalogItem = { name: string; price: number };
type Catalog = Record<PosCategory, CatalogItem[]>;

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

type WishRow = {
  id: string;
  created_at: string;
  type: "transfer" | "receive";
  currency: "USD" | "LBP";
  amount: number;
  note: string | null;
  counted?: boolean | null;
};

type DebtOnMeRow = {
  id: string;
  created_at: string;
  person: string | null;
  amount: number;
  currency: "USD" | "LBP" | string;
  note: string | null;
  paid: boolean | null;
  paid_at?: string | null;
  pay_source?: "cash" | "wish" | null;
};

const LS_CATALOG_KEY = "mokhtar_pos_catalog_v1";

function money(n: number) {
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

// Lebanon-friendly normalizer: 03xxxxxx -> 9613xxxxxx
function normalizePhone(p: string) {
  const digits = String(p || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return "961" + digits.slice(1);
  if (digits.startsWith("961")) return digits;
  return digits;
}

function defaultCatalog(): Catalog {
  return {
    Phones: [],
    Accessories: [{ name: "Cover", price: 5 }],
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

function safeLoadCatalog(): Catalog {
  try {
    if (typeof window === "undefined") return defaultCatalog();
    const raw = localStorage.getItem(LS_CATALOG_KEY);
    if (!raw) return defaultCatalog();

    const parsed = JSON.parse(raw);
    const base = defaultCatalog();

    for (const k of CATEGORIES) {
      const v = parsed?.[k];
      if (Array.isArray(v)) {
        base[k] = v
          .map((x: any) => ({
            name: String(x?.name ?? "").trim(),
            price: Number(x?.price ?? 0),
          }))
          .filter((x: CatalogItem) => x.name.length > 0);
      }
    }
    return base;
  } catch {
    return defaultCatalog();
  }
}

function safeSaveCatalog(catalog: Catalog) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_CATALOG_KEY, JSON.stringify(catalog));
}

export default function SalesPage() {
  // ---------- TOP NAV STATE ----------
  const [tab, setTab] = useState<MainTab>("pos");
  const [category, setCategory] = useState<PosCategory>("Phones");
  const [payType, setPayType] = useState<PayType>("cash");

  // ---------- CATALOG / MANAGE ----------
  const [catalog, setCatalog] = useState<Catalog>(() => defaultCatalog());
  const [isManageOpen, setIsManageOpen] = useState(false);

  // ---------- CART ----------
  const [cart, setCart] = useState<CartItem[]>([]);
  const [note, setNote] = useState("");

  // payout (amount-only)
  const [payoutAmount, setPayoutAmount] = useState<string>("");

  // custom item add
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState<string>("");
  const customNameRef = useRef<HTMLInputElement | null>(null);

  // debt fields (customer)
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [dueAt, setDueAt] = useState<string>(""); // datetime-local

  // latest sales
  const [latest, setLatest] = useState<SaleRow[]>([]);
  const [cashBalance, setCashBalance] = useState<number>(0);
  const [cashInToday, setCashInToday] = useState<number>(0);
  const [cashOutToday, setCashOutToday] = useState<number>(0);

  // app state
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // delete gate
  const [canDelete, setCanDelete] = useState(false);

  // ---------- WISH ----------
  const [wishType, setWishType] = useState<"transfer" | "receive">("transfer");
  const [wishCurrency, setWishCurrency] = useState<"USD" | "LBP">("USD");
  const [wishAmount, setWishAmount] = useState<string>("");
  const [wishCounted, setWishCounted] = useState<boolean>(false);

  const [wishUsdBalance, setWishUsdBalance] = useState<number>(0);
  const [wishLbpBalance, setWishLbpBalance] = useState<number>(0);
  const [wishSystemUsd, setWishSystemUsd] = useState<number>(0);
  const [wishSystemLbp, setWishSystemLbp] = useState<number>(0);

  const [wishLatest, setWishLatest] = useState<WishRow[]>([]);

  // ---------- DEBT ON ME ----------
  const [domPerson, setDomPerson] = useState("");
  const [domAmount, setDomAmount] = useState<string>("");
  const [domCurrency, setDomCurrency] = useState<"USD" | "LBP">("USD");
  const [domNote, setDomNote] = useState("");
  const [debtsOnMe, setDebtsOnMe] = useState<DebtOnMeRow[]>([]);

  // ---------- INIT ----------
  useEffect(() => {
    // catalog
    setCatalog(safeLoadCatalog());

    // delete session
    if (typeof window !== "undefined") {
      const ok = sessionStorage.getItem("canDelete") === "1";
      setCanDelete(ok);
    }

    // load data
    refreshLatest();
    refreshWishBalancesAndHistory();
    refreshDebtsOnMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // payout is amount-only and should not keep cart items
    if (tab === "pos" && payType === "payout") setCart([]);
  }, [payType, tab]);

  const categoryItems = useMemo(() => {
    return catalog[category] ?? [];
  }, [catalog, category]);

  const total = useMemo(() => {
    return cart.reduce((s, it) => s + (Number.isFinite(it.price) ? it.price : 0) * (it.qty || 0), 0);
  }, [cart]);

  function startOfTodayISO() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  // ---------- CASH METRICS ----------
  async function refreshCashMetrics() {
    try {
      const { data, error } = await supabase
        .from("sales")
        .select("amount,pay_type,created_at,deleted_at")
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
      // ignore
    }
  }

  // ---------- LATEST SALES ----------
  async function refreshLatest() {
    const { data, error } = await supabase
      .from("sales")
      .select("id,created_at,category,amount,pay_type,note,items,deleted_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(12);

    if (error) {
      setErr(error.message);
      return;
    }
    setLatest((data ?? []) as any);
    refreshCashMetrics();
  }

  // ---------- WISH (BALANCES + HISTORY) ----------
  async function refreshWishBalancesAndHistory() {
    // 1) history
    const h = await supabase
      .from("wish_transactions")
      .select("id,created_at,type,currency,amount,note,counted")
      .order("created_at", { ascending: false })
      .limit(25);

    if (!h.error) setWishLatest((h.data ?? []) as any);

    // 2) balances
    const { data, error } = await supabase
      .from("wish_transactions")
      .select("type,currency,amount,counted")
      .order("created_at", { ascending: false })
      .limit(5000);

    if (error) return;

    let usd = 0;
    let lbp = 0;
    let systemUsd = 0;
    let systemLbp = 0;

    for (const r of data || []) {
      const amt = Number((r as any).amount || 0);
      const type = (r as any).type as "transfer" | "receive";
      const cur = (r as any).currency as "USD" | "LBP";
      const counted = Boolean((r as any).counted);

      // Balance: transfer يزيد، receive ينقص
      const sign = type === "transfer" ? +1 : -1;
      if (cur === "USD") usd += sign * amt;
      if (cur === "LBP") lbp += sign * amt;

      // System: فقط إذا counted ✔
      if (counted) {
        const sysSign = type === "receive" ? +1 : -1; // receive counted يزيد، transfer counted ينقص
        if (cur === "USD") systemUsd += sysSign * amt;
        if (cur === "LBP") systemLbp += sysSign * amt;
      }
    }

    setWishUsdBalance(usd);
    setWishLbpBalance(lbp);
    setWishSystemUsd(systemUsd);
    setWishSystemLbp(systemLbp);
  }

  async function saveWish() {
    setErr(null);
    setLoading(true);

    try {
      const amt = Number(wishAmount);
      if (!Number.isFinite(amt) || amt <= 0) {
        setErr("Enter Wish amount.");
        return;
      }

      const { error } = await supabase.from("wish_transactions").insert({
        type: wishType,
        currency: wishCurrency,
        amount: amt,
        note: note.trim() || null,
        counted: wishCounted,
      });

      if (error) throw error;

      notify(
        `Wish ${wishType === "transfer" ? "Transfer (+)" : "Receive (-)"}${wishCounted ? " • COUNTED ✔" : ""}`,
        `${wishCurrency} ${wishCurrency === "USD" ? amt.toFixed(2) : amt.toLocaleString()}${note.trim() ? ` • ${note.trim()}` : ""}`
      );

      setWishAmount("");
      setWishCounted(false);
      setNote("");
      await refreshWishBalancesAndHistory();
    } catch (e: any) {
      setErr(e?.message ?? "Wish failed");
    } finally {
      setLoading(false);
    }
  }

  // ---------- DEBTS ON ME ----------
  async function refreshDebtsOnMe() {
    const { data, error } = await supabase
      .from("debts_on_me")
      .select("id,created_at,person,amount,currency,note,paid,paid_at,pay_source")
      .order("created_at", { ascending: false })
      .limit(30);

    if (!error) setDebtsOnMe((data ?? []) as any);
  }

  async function addDebtOnMe() {
    setErr(null);
    setLoading(true);

    try {
      const amt = Number(domAmount);
      if (!domPerson.trim()) {
        setErr("Enter person name.");
        return;
      }
      if (!Number.isFinite(amt) || amt <= 0) {
        setErr("Enter amount.");
        return;
      }

      const { error } = await supabase.from("debts_on_me").insert({
        person: domPerson.trim(),
        amount: amt,
        currency: domCurrency,
        note: domNote.trim() || null,
        paid: false,
      });

      if (error) throw error;

      notify("Debt On Me (new)", `${domPerson.trim()} • ${domCurrency} ${domCurrency === "USD" ? amt.toFixed(2) : amt.toLocaleString()}${domNote.trim() ? ` • ${domNote.trim()}` : ""}`);

      setDomPerson("");
      setDomAmount("");
      setDomCurrency("USD");
      setDomNote("");
      await refreshDebtsOnMe();
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function payDebtOnMe(row: DebtOnMeRow, source: "cash" | "wish") {
    setErr(null);
    setLoading(true);

    try {
      const amt = Number(row.amount || 0);
      if (!Number.isFinite(amt) || amt <= 0) return;

      // 1) apply impact
      if (source === "cash") {
        // payout reduces cash
        const { error } = await supabase.from("sales").insert({
          category: "Debt On Me",
          amount: amt,
          pay_type: "payout",
          note: `Paid debt to ${row.person || "unknown"}${row.note ? ` • ${row.note}` : ""}`,
          items: [],
        });
        if (error) throw error;

        notify("Debt On Me paid (Cash)", `${money(amt)} • ${row.person || ""}`);
      } else {
        // wish payment = money out => receive (-)
        const cur = (row.currency as any) === "LBP" ? "LBP" : "USD";
        const { error } = await supabase.from("wish_transactions").insert({
          type: "receive",
          currency: cur,
          amount: amt,
          note: `Debt On Me paid to ${row.person || "unknown"}${row.note ? ` • ${row.note}` : ""}`,
          counted: false, // عادة دفع دين مش system counted
        });
        if (error) throw error;

        notify("Debt On Me paid (Wish)", `${cur} ${cur === "USD" ? amt.toFixed(2) : amt.toLocaleString()} • ${row.person || ""}`);
      }

      // 2) mark paid
      const { error: uErr } = await supabase
        .from("debts_on_me")
        .update({ paid: true, paid_at: new Date().toISOString(), pay_source: source })
        .eq("id", row.id);

      if (uErr) throw uErr;

      await refreshLatest();
      await refreshWishBalancesAndHistory();
      await refreshDebtsOnMe();
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    } finally {
      setLoading(false);
    }
  }

  // ---------- POS ACTIONS ----------
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
          category: String(category),
          amount: amt,
          pay_type: "payout",
          note: note.trim() || null,
          items: [],
        });

        if (error) throw error;

        notify("Payout (-)", `${money(amt)} • ${note.trim() || String(category)}`);

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
          category: String(category),
          amount,
          pay_type: payType,
          note: note.trim() || null,
          items: itemsPayload,
        })
        .select("id")
        .single();

      if (saleErr) throw saleErr;

      const itemsText = itemsPayload.map((x) => `${x.qty}x ${x.name}`).join(", ");
      const baseLine =
        `${String(category)} • ${money(amount)}` +
        (itemsText ? ` • ${itemsText}` : "") +
        (note.trim() ? ` • ${note.trim()}` : "");

      if (payType === "cash") notify("Sale (+)", baseLine);

      if (payType === "debt") {
        notify(
          "Debt (new)",
          `${customerName.trim()} • ${customerPhone.trim()} • ${money(amount)}${dueAt ? ` • Due: ${new Date(dueAt).toLocaleString()}` : ""}`
        );
      }

      // If debt: create a debt record + open WhatsApp
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

        const waPhone = normalizePhone(customerPhone.trim());
        if (waPhone) {
          const waMsg =
            `مرحبا ${customerName.trim()} 👋\n` +
            `تذكير بالدفع - Mokhtar Cell\n` +
            `المبلغ: ${money(amount)}\n` +
            (dueAt ? `الموعد: ${new Date(dueAt).toLocaleString()}\n` : "") +
            (note.trim() ? `ملاحظة: ${note.trim()}\n` : "") +
            (itemsText ? `Items: ${itemsText}\n` : "") +
            `\n---\n` +
            `Hi ${customerName.trim()} 👋\n` +
            `Payment reminder - Mokhtar Cell\n` +
            `Amount: ${money(amount)}\n` +
            (dueAt ? `Due: ${new Date(dueAt).toLocaleString()}\n` : "") +
            (note.trim() ? `Note: ${note.trim()}\n` : "") +
            (itemsText ? `Items: ${itemsText}\n` : "");

          window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(waMsg)}`, "_blank");
        }
      }

      // reset
      setCart([]);
      setNote("");
      setCustomerName("");
      setCustomerPhone("");
      setDueAt("");
      await refreshLatest();
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function softDelete(id: string) {
    // password gate مرة وحدة
    if (!canDelete) {
      const pass = prompt("Enter delete password:");
      if (pass !== "1234") {
        alert("Wrong password");
        return;
      }
      setCanDelete(true);
      if (typeof window !== "undefined") sessionStorage.setItem("canDelete", "1");
    }

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
    const key = category as PosCategory;
    const nextCatalog: Catalog = { ...catalog, [key]: nextItems };
    setCatalog(nextCatalog);
    safeSaveCatalog(nextCatalog);
    setIsManageOpen(false);
  }

  // ---------- TOP CLICKERS ----------
  function goPos(p: PayType) {
    setTab("pos");
    setPayType(p);
  }
  function goWish() {
    setTab("wish");
  }
  function goDebtOnMe() {
    setTab("debtOnMe");
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

        {/* TOP METRICS */}
        <div className="grid metrics" style={{ marginTop: 14 }}>
          <div className="card">
            <div className="muted">Wish Balance (USD)</div>
            <div className="big">${Number(wishUsdBalance || 0).toFixed(2)}</div>
          </div>

          <div className="card">
            <div className="muted">Wish Balance (LBP)</div>
            <div className="big">{Number(wishLbpBalance || 0).toLocaleString()} LBP</div>
          </div>

          <div className="card">
            <div className="muted">Wish System (USD)</div>
            <div className="big">${Number(wishSystemUsd || 0).toFixed(2)}</div>
            <div className="tiny">Receive ✔ يزيد • Transfer ✔ ينقص</div>
          </div>

          <div className="card">
            <div className="muted">Wish System (LBP)</div>
            <div className="big">{Number(wishSystemLbp || 0).toLocaleString()} LBP</div>
            <div className="tiny">Receive ✔ يزيد • Transfer ✔ ينقص</div>
          </div>

          <div className="card">
            <div className="muted">Cash balance</div>
            <div className="big">{money(cashBalance)}</div>
            <div className="tiny">cash in − payout</div>
          </div>

          <div className="card">
            <div className="muted">Cash in/out (today)</div>
            <div className="big">{money(cashInToday - cashOutToday)}</div>
            <div className="tiny">today net</div>
          </div>
        </div>

        {err ? <div className="toast error">{err}</div> : null}

        <div className="grid two">
          {/* LEFT */}
          <div className="card">
            <div className="sectionTitle">POS</div>

            {/* TOP MAIN PILLS */}
            <div className="payTop">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className={`pill ${tab === "pos" && payType === "cash" ? "active" : ""}`} onClick={() => goPos("cash")} type="button">
                  Cash (+)
                </button>
                <button className={`pill ${tab === "pos" && payType === "debt" ? "active" : ""}`} onClick={() => goPos("debt")} type="button">
                  Debt
                </button>
                <button className={`pill ${tab === "pos" && payType === "payout" ? "active" : ""}`} onClick={() => goPos("payout")} type="button">
                  Payout (-)
                </button>

                <button className={`pill ${tab === "wish" ? "active" : ""}`} onClick={goWish} type="button">
                  Wish
                </button>

                <button className={`pill ${tab === "debtOnMe" ? "active" : ""}`} onClick={goDebtOnMe} type="button">
                  Debt On Me
                </button>
              </div>

              {/* RIGHT BOX */}
              {tab === "pos" ? (
                <div className="payTopRight">
                  <div className="muted" style={{ fontWeight: 900, fontSize: 12 }}>Total</div>
                  <div className="big" style={{ fontSize: 22 }}>
                    {payType === "payout" ? money(Number(payoutAmount || 0)) : money(total)}
                  </div>
                  <button className="btn primary" type="button" onClick={onPay} disabled={loading}>
                    {loading ? "Saving…" : payType === "payout" ? "SAVE" : "PAY"}
                  </button>
                </div>
              ) : tab === "wish" ? (
                <div className="payTopRight">
                  <div className="muted" style={{ fontWeight: 900, fontSize: 12 }}>Wish</div>
                  <div className="big" style={{ fontSize: 22 }}>
                    {wishCurrency === "USD" ? `$${Number(wishUsdBalance || 0).toFixed(2)}` : `${Number(wishLbpBalance || 0).toLocaleString()} LBP`}
                  </div>
                  <button className="btn primary" type="button" onClick={saveWish} disabled={loading}>
                    {loading ? "Saving…" : "SAVE WISH"}
                  </button>
                </div>
              ) : (
                <div className="payTopRight">
                  <div className="muted" style={{ fontWeight: 900, fontSize: 12 }}>Debt On Me</div>
                  <div className="big" style={{ fontSize: 22 }}>
                    {domCurrency === "USD" ? money(Number(domAmount || 0)) : `${Number(domAmount || 0).toLocaleString()} LBP`}
                  </div>
                  <button className="btn primary" type="button" onClick={addDebtOnMe} disabled={loading}>
                    {loading ? "Saving…" : "ADD"}
                  </button>
                </div>
              )}
            </div>

            {/* POS Categories */}
            {tab === "pos" ? (
              <div className="pillRow">
                {CATEGORIES.map((c) => (
                  <button key={c} className={`pill ${category === c ? "active" : ""}`} onClick={() => setCategory(c)} type="button">
                    {c}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="divider" />

            {/* CONTENT */}
            {tab === "wish" ? (
              <>
                <div className="sectionTitle" style={{ marginTop: 6 }}>Wish System</div>
                <div className="muted">
                  Transfer يزيد الرصيد • Receive ينقص — واذا Count ✔:
                  <span style={{ fontWeight: 900 }}> Receive يزيد System</span> و <span style={{ fontWeight: 900 }}>Transfer ينقص System</span>
                </div>

                <div className="pillRow" style={{ marginTop: 12 }}>
                  <button className={`pill ${wishType === "transfer" ? "active" : ""}`} onClick={() => setWishType("transfer")} type="button">
                    Transfer (+)
                  </button>
                  <button className={`pill ${wishType === "receive" ? "active" : ""}`} onClick={() => setWishType("receive")} type="button">
                    Receive (-)
                  </button>
                </div>

                <div className="pillRow" style={{ marginTop: 10 }}>
                  <button className={`pill ${wishCurrency === "USD" ? "active" : ""}`} onClick={() => setWishCurrency("USD")} type="button">
                    USD
                  </button>
                  <button className={`pill ${wishCurrency === "LBP" ? "active" : ""}`} onClick={() => setWishCurrency("LBP")} type="button">
                    LBP
                  </button>

                  <button className={`pill ${wishCounted ? "active" : ""}`} onClick={() => setWishCounted((v) => !v)} type="button">
                    Count ✔
                  </button>
                </div>

                <div className="row" style={{ marginTop: 12 }}>
                  <label className="label">Amount ({wishCurrency})</label>
                  <input className="input" value={wishAmount} onChange={(e) => setWishAmount(e.target.value)} placeholder={wishCurrency === "USD" ? "e.g. 50" : "e.g. 1500000"} />
                </div>

                <div className="row">
                  <label className="label">Note (details)</label>
                  <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
                </div>

                <div className="divider" />

                <div className="sectionTitle" style={{ marginTop: 6 }}>Wish History</div>
                <div className="muted">آخر عمليات Transfer / Receive</div>

                <div style={{ marginTop: 10 }}>
                  {wishLatest.length === 0 ? <div className="muted">No wish transactions yet.</div> : null}

                  {wishLatest.map((w) => (
                    <div key={w.id} className="saleRow">
                      <div>
                        <div className="saleTitle">
                          {w.type === "transfer" ? "Transfer (+)" : "Receive (-)"} • {w.currency}
                          {w.counted ? " • COUNTED ✔" : ""}
                        </div>
                        <div className="saleSub">
                          {new Date(w.created_at).toLocaleString()}
                          {w.note ? ` • ${w.note}` : ""}
                        </div>
                      </div>
                      <div className="saleRight">
                        <div className="big">
                          {w.currency === "USD" ? `$${Number(w.amount).toFixed(2)}` : `${Number(w.amount).toLocaleString()} LBP`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : tab === "debtOnMe" ? (
              <>
                <div className="sectionTitle" style={{ marginTop: 6 }}>Debt On Me</div>
                <div className="muted">سجّل دين عليك… ولما تدفعه: Cash ينقص من الصندوق / Wish ينقص من الـWish</div>

                <div className="grid three" style={{ marginTop: 12, gap: 10 }}>
                  <input className="input" value={domPerson} onChange={(e) => setDomPerson(e.target.value)} placeholder="Person (e.g. Ali)" />
                  <input className="input" value={domAmount} onChange={(e) => setDomAmount(e.target.value)} placeholder={domCurrency === "USD" ? "Amount (USD)" : "Amount (LBP)"} />
                  <div style={{ display: "flex", gap: 10 }}>
                    <button className={`pill ${domCurrency === "USD" ? "active" : ""}`} onClick={() => setDomCurrency("USD")} type="button">USD</button>
                    <button className={`pill ${domCurrency === "LBP" ? "active" : ""}`} onClick={() => setDomCurrency("LBP")} type="button">LBP</button>
                  </div>
                </div>

                <div className="row">
                  <label className="label">Note</label>
                  <input className="input" value={domNote} onChange={(e) => setDomNote(e.target.value)} placeholder="Optional" />
                </div>

                <div className="divider" />

                <div className="sectionTitle" style={{ marginTop: 6 }}>Latest debts on me</div>
                <div className="muted">Pending / Paid</div>

                <div style={{ marginTop: 10 }}>
                  {debtsOnMe.length === 0 ? <div className="muted">No debts on me yet.</div> : null}

                  {debtsOnMe.map((d) => {
                    const amtText =
                      (d.currency as any) === "LBP"
                        ? `${Number(d.amount || 0).toLocaleString()} LBP`
                        : `$${Number(d.amount || 0).toFixed(2)}`;

                    return (
                      <div key={d.id} className="saleRow">
                        <div>
                          <div className="saleTitle">
                            {d.person || "Unknown"} • {amtText} {d.paid ? " • PAID ✅" : " • PENDING ⏳"}
                          </div>
                          <div className="saleSub">
                            {new Date(d.created_at).toLocaleString()}
                            {d.note ? ` • ${d.note}` : ""}
                            {d.paid && d.pay_source ? ` • via ${String(d.pay_source).toUpperCase()}` : ""}
                          </div>
                        </div>

                        <div className="saleRight">
                          {!d.paid ? (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                              <button className="btn" type="button" disabled={loading} onClick={() => payDebtOnMe(d, "cash")}>
                                Pay Cash
                              </button>
                              <button className="btn primary" type="button" disabled={loading} onClick={() => payDebtOnMe(d, "wish")}>
                                Pay Wish
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                {/* POS UI */}
                {payType === "payout" ? (
                  <div style={{ marginTop: 14 }}>
                    <div className="row">
                      <label className="label">Payout amount (USD)</label>
                      <input className="input" value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)} placeholder="e.g. 20" />
                    </div>

                    <div style={{ marginTop: 12 }} className="row">
                      <label className="label">Note (why payout?)</label>
                      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
                    </div>

                    <div className="muted" style={{ marginTop: 10, fontWeight: 800 }}>
                      Payout will reduce cash balance.
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
                      {categoryItems.length === 0 ? <div className="muted">No quick items in this category.</div> : null}
                      {categoryItems.map((it, idx) => (
                        <button key={`${it.name}-${idx}`} type="button" className="pill" onClick={() => addToCart(it.name, it.price)}>
                          {it.name}
                          <span className="pillSub">{it.price ? money(it.price) : ""}</span>
                        </button>
                      ))}
                    </div>

                    <div className="row" style={{ marginTop: 14 }}>
                      <label className="label">Custom item</label>
                      <div className="grid three" style={{ gap: 10 }}>
                        <input ref={customNameRef} className="input" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Item name" />
                        <input className="input" value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} placeholder="Price (USD)" />
                        <button className="btn" type="button" onClick={addCustom}>
                          Add
                        </button>
                      </div>
                    </div>

                    <div className="divider" />

                    <div className="sectionTitle" style={{ marginTop: 6 }}>Cart</div>
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
                              <input className="miniInput" value={String(it.qty)} onChange={(e) => updateCart(i, { qty: Number(e.target.value || 0) })} />
                            </div>
                            <div className="mini">
                              <span className="miniLabel">Price</span>
                              <input className="miniInput" value={String(it.price)} onChange={(e) => updateCart(i, { price: Number(e.target.value || 0) })} />
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
                          <input className="input" placeholder="Customer name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                          <input className="input" placeholder="Customer phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
                        </div>

                        <div className="row" style={{ marginTop: 10 }}>
                          <label className="label">Due date & time</label>
                          <input className="input" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
                          <div className="muted" style={{ marginTop: 6 }}>
                            After saving debt, WhatsApp opens directly with a ready message.
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div style={{ marginTop: 12 }} className="row">
                      <label className="label">Note (details)</label>
                      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
                    </div>

                    <div className="muted" style={{ marginTop: 10, fontWeight: 800 }}>
                      Tip: Edit price directly in cart before Pay.
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* RIGHT */}
          <div className="card">
            <div className="sectionTitle">Latest sales</div>
            <div className="muted">Deletes are soft (hidden from totals).</div>

            <div style={{ marginTop: 10 }}>
              {latest.length === 0 ? <div className="muted">No sales yet.</div> : null}
              {latest.map((s) => {
                const itemsLine =
                  Array.isArray(s.items) && s.items.length ? s.items.map((x: any) => `${x.qty || 1}x ${x.name}`).join(", ") : "";

                return (
                  <div key={s.id} className="saleRow">
                    <div>
                      <div className="saleTitle">{s.category} • {String(s.pay_type).toUpperCase()}</div>
                      <div className="saleSub">
                        {new Date(s.created_at).toLocaleString()}
                        {s.note ? ` • ${s.note}` : ""}
                        {itemsLine ? ` • ${itemsLine}` : ""}
                      </div>
                    </div>
                    <div className="saleRight">
                      <div className="big">{money(s.amount)}</div>
                      <button className="btn danger" type="button" onClick={() => softDelete(s.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Manage modal */}
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
        .page { padding: 16px; }
        .header h1 { margin: 0; font-size: 34px; letter-spacing: -0.02em; }
        .sub { opacity: 0.7; margin-top: 6px; }

        .grid { display: grid; gap: 14px; }
        .grid.two { grid-template-columns: 1.2fr 0.8fr; }
        .grid.three { grid-template-columns: 1.4fr 0.8fr 0.6fr; }
        .grid.metrics { grid-template-columns: repeat(6, 1fr); }
        @media (max-width: 1180px) { .grid.metrics { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 980px) { .grid.two { grid-template-columns: 1fr; } }

        .card {
          border-radius: 18px;
          background: rgba(0,0,0,0.20);
          border: 1px solid rgba(255,255,255,0.10);
          padding: 14px;
          box-shadow: 0 18px 48px rgba(0,0,0,0.25);
          backdrop-filter: blur(8px);
        }

        .divider { height: 1px; background: rgba(255,255,255,0.08); margin: 14px 0; }
        .row { margin-top: 10px; }
        .label { display:block; font-size: 12px; color: rgba(255,255,255,0.65); margin-bottom: 6px; }

        .input {
          width: 100%;
          padding: 10px 12px;
          border-radius: 12px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.08);
          color: white;
          outline: none;
        }

        .btn {
          padding: 10px 14px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(255,255,255,0.06);
          color: white;
          cursor: pointer;
        }
        .btn.primary {
          background: linear-gradient(90deg, rgba(246,196,83,0.95), rgba(212,161,42,0.95));
          border-color: rgba(246,196,83,0.35);
          color: #1a1306;
          font-weight: 900;
        }
        .btn.danger { background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.35); }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .link { background: transparent; border: none; color: rgba(246,196,83,1); cursor: pointer; font-weight: 900; }

        .pillRow { display:flex; flex-wrap: wrap; gap: 10px; }
        .pill {
          padding: 10px 14px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(255,255,255,0.04);
          color: white;
          cursor:pointer;
          transition: 0.15s ease;
        }
        .pill:hover { transform: translateY(-1px); }
        .pill.active { background: rgba(246,196,83,0.14); border-color: rgba(246,196,83,0.35); }

        .payTop {
          display:flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 10px;
          padding: 12px;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(0,0,0,0.18);
        }
        .payTopRight { display:flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }

        .pillSub { margin-left: 8px; opacity: 0.65; font-size: 12px; }

        .muted { color: rgba(255,255,255,0.55); font-size: 13px; }
        .big { font-size: 20px; font-weight: 800; }
        .tiny { color: rgba(255,255,255,0.5); font-size: 12px; margin-top: 4px; }

        .cart { margin-top: 10px; display:flex; flex-direction: column; gap: 10px; }
        .cartRow {
          display:flex; justify-content: space-between; gap: 12px;
          padding: 12px; border-radius: 16px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
        }
        .cartName { font-weight: 800; }
        .cartSub { font-size: 12px; opacity: 0.7; margin-top: 2px; }
        .cartControls { display:flex; align-items: center; gap: 10px; }

        .mini { display:flex; align-items: center; gap: 8px; }
        .miniLabel { font-size: 12px; opacity: 0.65; }
        .miniInput {
          width: 70px; padding: 8px 10px;
          border-radius: 12px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.08);
          color: white;
        }

        .saleRow {
          display:flex; justify-content: space-between; align-items:flex-start; gap: 12px;
          padding: 12px; border-radius: 16px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          margin-top: 10px;
        }
        .saleTitle { font-weight: 800; }
        .saleSub { font-size: 12px; opacity: 0.7; margin-top: 2px; }
        .saleRight { display:flex; flex-direction: column; align-items:flex-end; gap: 8px; }

        .toast.error {
          margin: 10px 0;
          padding: 10px 12px;
          border-radius: 14px;
          background: rgba(239,68,68,0.12);
          border: 1px solid rgba(239,68,68,0.35);
        }
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
  category: PosCategory;
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
              <input className="input" placeholder="Item name" value={r.name} onChange={(e) => updateRow(i, { name: e.target.value })} />
              <input className="input" placeholder="Price" value={String(r.price)} onChange={(e) => updateRow(i, { price: Number(e.target.value || 0) })} />
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
        .btn.primary { background: linear-gradient(90deg, rgba(246,196,83,0.95), rgba(212,161,42,0.95)); border-color: rgba(246,196,83,0.35); color: #1a1306; font-weight: 900; }
        .btn.danger { background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.35); }
        .muted { color: rgba(255,255,255,0.55); font-size: 13px; }
      `}</style>
    </div>
  );
}
