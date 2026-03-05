"use client";

export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import PushButtons from "@/components/PushButtons";
import { notify } from "@/lib/notify";
import PushInit from "@/components/PushInit";

/** POS categories (Wish is NOT here) */
const CATEGORIES = ["Phones", "Accessories", "Repair", "Services", "Other"] as const;

type PosCategory = (typeof CATEGORIES)[number];
type Category = PosCategory | "Wish" | "DebtOnMe";
type PayType = "cash" | "debt" | "payout";

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
  person: string;
  phone: string | null;
  amount: number;
  currency?: "USD" | "LBP" | null;
  note: string | null;
  status?: "pending" | "paid" | null;
  paid_at?: string | null;
  paid_via?: "cash" | "wish" | null;
};

const LS_CATALOG_KEY = "mokhtar_pos_catalog_v1";

function money(n: number) {
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

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

function saveCatalog(catalog: Catalog) {
  localStorage.setItem(LS_CATALOG_KEY, JSON.stringify(catalog));
}

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Fallback helper for schema-cache errors (missing columns). */
async function safeSelect<T = any>(
  table: string,
  withCols: string,
  withoutCols: string,
  opts?: { order?: { col: string; asc?: boolean }; limit?: number; whereDeletedNull?: boolean }
): Promise<{ data: T[]; usedFallback: boolean }> {
  const base = supabase.from(table).select(withCols);
  const q1 = opts?.whereDeletedNull ? base.is("deleted_at" as any, null) : base;
  const q2 =
    opts?.order?.col ? q1.order(opts.order.col, { ascending: !!opts.order.asc }) : q1;
  const q3 = opts?.limit ? q2.limit(opts.limit) : q2;

  const res1 = await q3;
  if (!res1.error) return { data: (res1.data ?? []) as any, usedFallback: false };

  // fallback without problematic columns
  const baseB = supabase.from(table).select(withoutCols);
  const qb1 = opts?.whereDeletedNull ? baseB.is("deleted_at" as any, null) : baseB;
  const qb2 =
    opts?.order?.col ? qb1.order(opts.order.col, { ascending: !!opts.order.asc }) : qb1;
  const qb3 = opts?.limit ? qb2.limit(opts.limit) : qb2;

  const res2 = await qb3;
  if (res2.error) throw res2.error;
  return { data: (res2.data ?? []) as any, usedFallback: true };
}

async function safeInsert(table: string, payloadWithExtra: any, payloadFallback: any) {
  const r1 = await supabase.from(table).insert(payloadWithExtra);
  if (!r1.error) return;
  const r2 = await supabase.from(table).insert(payloadFallback);
  if (r2.error) throw r2.error;
}

async function safeUpdate(table: string, patchWithExtra: any, patchFallback: any, id: string) {
  const r1 = await supabase.from(table).update(patchWithExtra).eq("id", id);
  if (!r1.error) return;
  const r2 = await supabase.from(table).update(patchFallback).eq("id", id);
  if (r2.error) throw r2.error;
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

  // debt fields (customer owes you)
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [dueAt, setDueAt] = useState<string>("");

  // latest sales
  const [latest, setLatest] = useState<SaleRow[]>([]);
  const [cashBalance, setCashBalance] = useState<number>(0);
  const [cashInToday, setCashInToday] = useState<number>(0);
  const [cashOutToday, setCashOutToday] = useState<number>(0);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [canDelete, setCanDelete] = useState(false);

  // ✅ WISH
  const [wishType, setWishType] = useState<"transfer" | "receive">("transfer");
  const [wishCurrency, setWishCurrency] = useState<"USD" | "LBP">("USD");
  const [wishAmount, setWishAmount] = useState<string>("");
  const [wishCount, setWishCount] = useState<boolean>(false);
  const [wishUsdBalance, setWishUsdBalance] = useState<number>(0);
  const [wishLbpBalance, setWishLbpBalance] = useState<number>(0);

  // ✅ WISH SYSTEM (counted): receive+count => +system, transfer+count => -system
  const [wishSystemUsd, setWishSystemUsd] = useState<number>(0);
  const [wishSystemLbp, setWishSystemLbp] = useState<number>(0);
  const [wishLatest, setWishLatest] = useState<WishRow[]>([]);

  // ✅ DEBT ON ME (you owe others)
  const [debtPerson, setDebtPerson] = useState("");
  const [debtPhone, setDebtPhone] = useState("");
  const [debtAmount, setDebtAmount] = useState("");
  const [debtCurrency, setDebtCurrency] = useState<"USD" | "LBP">("USD");
  const [debtNote, setDebtNote] = useState("");
  const [debtsOnMe, setDebtsOnMe] = useState<DebtOnMeRow[]>([]);

  const isWish = category === "Wish";
  const isDebtOnMe = category === "DebtOnMe";

  useEffect(() => {
    setCatalog(loadCatalog());
    // restore delete permission in this tab
    if (typeof window !== "undefined") {
      if (sessionStorage.getItem("canDelete") === "1") setCanDelete(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (payType === "payout") setCart([]);
  }, [payType]);

  const categoryItems = useMemo(() => {
    if (isWish || isDebtOnMe) return [];
    return catalog[category as PosCategory] ?? [];
  }, [catalog, category, isWish, isDebtOnMe]);

  const total = useMemo(
    () =>
      cart.reduce(
        (s, it) => s + (Number.isFinite(it.price) ? it.price : 0) * (it.qty || 0),
        0
      ),
    [cart]
  );

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
      const cashIn = rows
        .filter((r) => r.pay_type === "cash")
        .reduce((a, r) => a + Number(r.amount || 0), 0);
      const cashOut = rows
        .filter((r) => r.pay_type === "payout")
        .reduce((a, r) => a + Number(r.amount || 0), 0);
      setCashBalance(cashIn - cashOut);

      const startISO = startOfTodayISO();
      const today = rows.filter((r) => (r.created_at || "") >= startISO);
      const tIn = today
        .filter((r) => r.pay_type === "cash")
        .reduce((a, r) => a + Number(r.amount || 0), 0);
      const tOut = today
        .filter((r) => r.pay_type === "payout")
        .reduce((a, r) => a + Number(r.amount || 0), 0);
      setCashInToday(tIn);
      setCashOutToday(tOut);
    } catch {
      // ignore
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

  async function refreshWishLatest() {
    try {
      const res = await safeSelect<WishRow>(
        "wish_transactions",
        "id,created_at,type,currency,amount,note,counted",
        "id,created_at,type,currency,amount,note",
        { order: { col: "created_at", asc: false }, limit: 25 }
      );
      const list = res.data.map((x: any) => ({
        ...x,
        counted: typeof x.counted === "boolean" ? x.counted : false,
      }));
      setWishLatest(list as any);
    } catch {
      setWishLatest([]);
    }
  }

  async function refreshWishBalances() {
    try {
      const res = await safeSelect<any>(
        "wish_transactions",
        "type,currency,amount,counted",
        "type,currency,amount",
        { order: { col: "created_at", asc: false }, limit: 5000 }
      );

      let usd = 0;
      let lbp = 0;
      let sysUsd = 0;
      let sysLbp = 0;

      for (const r of res.data || []) {
        const amt = Number(r.amount || 0);
        const type = r.type as "transfer" | "receive";
        const cur = r.currency as "USD" | "LBP";
        const counted = Boolean((r as any).counted);

        // Balance: transfer يزيد، receive ينقص
        const sign = type === "transfer" ? +1 : -1;
        if (cur === "USD") usd += sign * amt;
        if (cur === "LBP") lbp += sign * amt;

        // System: فقط إذا counted
        if (counted) {
          const sysSign = type === "receive" ? +1 : -1;
          if (cur === "USD") sysUsd += sysSign * amt;
          if (cur === "LBP") sysLbp += sysSign * amt;
        }
      }

      setWishUsdBalance(usd);
      setWishLbpBalance(lbp);
      setWishSystemUsd(sysUsd);
      setWishSystemLbp(sysLbp);
    } catch {
      // ignore
    }
  }

  async function refreshDebtsOnMe() {
    try {
      const res = await safeSelect<DebtOnMeRow>(
        "debts_on_me",
        "id,created_at,person,phone,amount,currency,note,status,paid_at,paid_via",
        "id,created_at,person,phone,amount,note,status,paid_at,paid_via",
        { order: { col: "created_at", asc: false }, limit: 30 }
      );

      // default currency if missing
      const mapped = res.data.map((d: any) => ({
        ...d,
        currency: (d.currency as any) || "USD",
        status: d.status || "pending",
      }));
      setDebtsOnMe(mapped as any);
    } catch {
      setDebtsOnMe([]);
    }
  }

  useEffect(() => {
    refreshLatest();
    refreshWishBalances();
    refreshWishLatest();
    refreshDebtsOnMe();
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

  async function saveWish() {
    setErr(null);
    setLoading(true);

    try {
      const amt = Number(wishAmount);
      if (!Number.isFinite(amt) || amt <= 0) {
        setErr("Enter Wish amount.");
        return;
      }

      // try insert with "counted", fallback without if column not exists
      await safeInsert(
        "wish_transactions",
        {
          type: wishType,
          currency: wishCurrency,
          amount: amt,
          note: note.trim() || null,
          counted: wishCount,
        },
        {
          type: wishType,
          currency: wishCurrency,
          amount: amt,
          note: note.trim() || null,
        }
      );

      notify(
        `Wish ${wishType === "transfer" ? "Transfer (+)" : "Receive (-)"}${wishCount ? " • COUNT ✔" : ""}`,
        `${wishCurrency} ${
          wishCurrency === "USD" ? amt.toFixed(2) : amt.toLocaleString()
        }${note.trim() ? ` • ${note.trim()}` : ""}`
      );

      setWishAmount("");
      setWishCount(false);
      setNote("");

      await refreshWishBalances();
      await refreshWishLatest();
    } catch (e: any) {
      setErr(e?.message ?? "Wish failed");
    } finally {
      setLoading(false);
    }
  }

  async function addDebtOnMe() {
    setErr(null);
    setLoading(true);
    try {
      const person = debtPerson.trim();
      const phone = debtPhone.trim() || null;
      const amt = Number(debtAmount);

      if (!person) {
        setErr("Enter person name.");
        return;
      }
      if (!Number.isFinite(amt) || amt <= 0) {
        setErr("Enter amount.");
        return;
      }

      // Insert as pending. Try with currency; fallback without if column missing.
      await safeInsert(
        "debts_on_me",
        {
          person,
          phone,
          amount: amt,
          currency: debtCurrency,
          note: debtNote.trim() || null,
          status: "pending",
        },
        {
          person,
          phone,
          amount: amt,
          note: debtNote.trim() || null,
          status: "pending",
        }
      );

      notify("Debt On Me (pending)", `${person} • ${debtCurrency} ${debtCurrency === "USD" ? amt.toFixed(2) : amt.toLocaleString()}`);

      setDebtPerson("");
      setDebtPhone("");
      setDebtAmount("");
      setDebtNote("");
      setDebtCurrency("USD");

      await refreshDebtsOnMe();
    } catch (e: any) {
      setErr(e?.message ?? "Debt On Me failed");
    } finally {
      setLoading(false);
    }
  }

  async function payDebtOnMe(row: DebtOnMeRow, via: "cash" | "wish") {
    setErr(null);
    setLoading(true);

    try {
      const cur = (row.currency as any) || "USD";
      const amt = Number(row.amount || 0);
      if (!Number.isFinite(amt) || amt <= 0) return;

      // 1) mark paid in debts_on_me
      await safeUpdate(
        "debts_on_me",
        { status: "paid", paid_at: new Date().toISOString(), paid_via: via, currency: cur },
        { status: "paid", paid_at: new Date().toISOString(), paid_via: via },
        row.id
      );

      // 2) effect on balances only when paying:
      // - cash: insert payout in sales (USD only)
      // - wish: insert wish "receive" (decrease wish balance) in the same currency
      if (via === "cash") {
        if (cur !== "USD") {
          setErr("Cash payments are USD only. Choose Wish for LBP.");
          return;
        }
        const { error } = await supabase.from("sales").insert({
          category: "Debt On Me",
          amount: amt,
          pay_type: "payout",
          note: `Pay debt: ${row.person}${row.note ? ` • ${row.note}` : ""}`,
          items: [],
        });
        if (error) throw error;
        notify("Debt On Me paid (cash)", `${row.person} • ${money(amt)}`);
        await refreshLatest();
      } else {
        // wish payment => receive (-)
        await safeInsert(
          "wish_transactions",
          {
            type: "receive",
            currency: cur,
            amount: amt,
            note: `Pay debt: ${row.person}${row.note ? ` • ${row.note}` : ""}`,
            counted: false,
          },
          {
            type: "receive",
            currency: cur,
            amount: amt,
            note: `Pay debt: ${row.person}${row.note ? ` • ${row.note}` : ""}`,
          }
        );
        notify("Debt On Me paid (wish)", `${row.person} • ${cur} ${cur === "USD" ? amt.toFixed(2) : amt.toLocaleString()}`);
        await refreshWishBalances();
        await refreshWishLatest();
      }

      await refreshDebtsOnMe();
    } catch (e: any) {
      setErr(e?.message ?? "Pay failed");
    } finally {
      setLoading(false);
    }
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
          `${customerName.trim()} • ${customerPhone.trim()} • ${money(amount)}${
            dueAt ? ` • Due: ${new Date(dueAt).toLocaleString()}` : ""
          }`
        );
      }

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

      setCart([]);
      setNote("");
      setCustomerName("");
      setCustomerPhone("");
      setDueAt("");
      await refreshLatest();
    } catch (e: any) {
      setErr(e?.message ?? "failed");
    } finally {
      setLoading(false);
    }
  }

  async function softDelete(id: string) {
    if (!canDelete) {
      const pass = prompt("Enter delete password:");
      if (pass !== "1234") {
        alert("Wrong password");
        return;
      }
      setCanDelete(true);
      sessionStorage.setItem("canDelete", "1");
    }

    const ok = confirm("Delete this sale? (It will be hidden from totals)");
    if (!ok) return;

    const { error } = await supabase
      .from("sales")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      setErr(error.message);
      return;
    }

    notify("Sale deleted", `A sale was deleted (hidden from totals).`);
    await refreshLatest();
  }

  function openManage() {
    if (isWish || isDebtOnMe) return;
    setIsManageOpen(true);
  }

  function saveManage(nextItems: CatalogItem[]) {
    if (isWish || isDebtOnMe) return;
    const key = category as PosCategory;
    const nextCatalog: Catalog = { ...catalog, [key]: nextItems };
    setCatalog(nextCatalog);
    saveCatalog(nextCatalog);
    setIsManageOpen(false);
  }

  const payTopLabel = isWish ? "Wish" : isDebtOnMe ? "Debt On Me" : "Total";
  const payTopAmount = isWish
    ? wishCurrency === "USD"
      ? `$${Number(wishUsdBalance || 0).toFixed(2)}`
      : `${Number(wishLbpBalance || 0).toLocaleString()} LBP`
    : isDebtOnMe
    ? debtCurrency === "USD"
      ? `$${Number(debtAmount || 0).toFixed(2)}`
      : `${Number(debtAmount || 0).toLocaleString()} LBP`
    : payType === "payout"
    ? money(Number(payoutAmount || 0))
    : money(total);

  return (
    <>
      <PushInit />

      <div className="page">
        <div className="header">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
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
        </div>

        {err ? <div className="toast error">{err}</div> : null}

        <div className="grid two">
          {/* LEFT */}
          <div className="card">
            <div className="sectionTitle">POS</div>

            {/* Top Pay Controls + Wish + DebtOnMe */}
            <div className="payTop">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className={`pill ${payType === "cash" && !isWish && !isDebtOnMe ? "active" : ""}`}
                  onClick={() => {
                    setPayType("cash");
                    setCategory("Phones");
                  }}
                  type="button"
                >
                  Cash (+)
                </button>
                <button
                  className={`pill ${payType === "debt" && !isWish && !isDebtOnMe ? "active" : ""}`}
                  onClick={() => {
                    setPayType("debt");
                    setCategory("Phones");
                  }}
                  type="button"
                >
                  Debt
                </button>
                <button
                  className={`pill ${payType === "payout" && !isWish && !isDebtOnMe ? "active" : ""}`}
                  onClick={() => {
                    setPayType("payout");
                    setCategory("Phones");
                  }}
                  type="button"
                >
                  Payout (-)
                </button>

                <button
                  className={`pill ${isWish ? "active" : ""}`}
                  onClick={() => setCategory("Wish")}
                  type="button"
                >
                  Wish
                </button>

                <button
                  className={`pill ${isDebtOnMe ? "active" : ""}`}
                  onClick={() => setCategory("DebtOnMe")}
                  type="button"
                >
                  Debt On Me
                </button>
              </div>

              <div className="payTopRight">
                <div className="muted" style={{ fontWeight: 900, fontSize: 12 }}>
                  {payTopLabel}
                </div>
                <div className="big" style={{ fontSize: 22 }}>
                  {payTopAmount}
                </div>

                {!isWish && !isDebtOnMe ? (
                  <button className="btn primary" type="button" onClick={onPay} disabled={loading}>
                    {loading ? "Saving…" : payType === "payout" ? "SAVE" : "PAY"}
                  </button>
                ) : isWish ? (
                  <button className="btn primary" type="button" onClick={saveWish} disabled={loading}>
                    {loading ? "Saving…" : "SAVE WISH"}
                  </button>
                ) : (
                  <button className="btn primary" type="button" onClick={addDebtOnMe} disabled={loading}>
                    {loading ? "Saving…" : "ADD"}
                  </button>
                )}
              </div>
            </div>

            {/* Categories row (POS only) */}
            {!isWish && !isDebtOnMe ? (
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
            ) : null}

            <div className="divider" />

            {/* ✅ WISH UI */}
            {isWish ? (
              <>
                <div className="sectionTitle" style={{ marginTop: 6 }}>
                  Wish System
                </div>
                <div className="muted">Transfer يزيد الرصيد • Receive ينقص (ما بيتدخل بالكاش)</div>

                <div className="divider" />

                <div className="pillRow">
                  <button
                    className={`pill ${wishType === "transfer" ? "active" : ""}`}
                    onClick={() => setWishType("transfer")}
                    type="button"
                  >
                    Transfer (+)
                  </button>
                  <button
                    className={`pill ${wishType === "receive" ? "active" : ""}`}
                    onClick={() => setWishType("receive")}
                    type="button"
                  >
                    Receive (-)
                  </button>

                  <button
                    className={`pill ${wishCount ? "active" : ""}`}
                    onClick={() => setWishCount((v) => !v)}
                    type="button"
                    title="If ON: affects Wish System (receive يزيد، transfer ينقص)"
                  >
                    COUNT ✔
                  </button>
                </div>

                <div className="pillRow" style={{ marginTop: 10 }}>
                  <button
                    className={`pill ${wishCurrency === "USD" ? "active" : ""}`}
                    onClick={() => setWishCurrency("USD")}
                    type="button"
                  >
                    USD
                  </button>
                  <button
                    className={`pill ${wishCurrency === "LBP" ? "active" : ""}`}
                    onClick={() => setWishCurrency("LBP")}
                    type="button"
                  >
                    LBP
                  </button>
                </div>

                <div className="row" style={{ marginTop: 12 }}>
                  <label className="label">Amount ({wishCurrency})</label>
                  <input
                    className="input"
                    value={wishAmount}
                    onChange={(e) => setWishAmount(e.target.value)}
                    placeholder={wishCurrency === "USD" ? "e.g. 50" : "e.g. 1500000"}
                  />
                </div>

                <div className="row">
                  <label className="label">Note (details)</label>
                  <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
                </div>

                <div className="muted" style={{ marginTop: 10, fontWeight: 800 }}>
                  Tip: Balance: Transfer يزيد • Receive ينقص — System: COUNT ✔ Receive يزيد • Transfer ينقص
                </div>

                <div className="divider" />

                <div className="sectionTitle" style={{ marginTop: 6 }}>
                  Wish History
                </div>
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
                          {w.currency === "USD"
                            ? `$${Number(w.amount).toFixed(2)}`
                            : `${Number(w.amount).toLocaleString()} LBP`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : isDebtOnMe ? (
              <>
                <div className="sectionTitle" style={{ marginTop: 6 }}>
                  Debt On Me
                </div>
                <div className="muted">
                  Add فقط (Pending). بعدين بتختار Pay: Cash أو Wish (وقتها بس بينقص الرصيد).
                </div>

                <div className="row" style={{ marginTop: 12 }}>
                  <label className="label">Person</label>
                  <input
                    className="input"
                    value={debtPerson}
                    onChange={(e) => setDebtPerson(e.target.value)}
                    placeholder="Person (e.g. Ali)"
                  />
                </div>

                <div className="row">
                  <label className="label">Phone</label>
                  <input
                    className="input"
                    value={debtPhone}
                    onChange={(e) => setDebtPhone(e.target.value)}
                    placeholder="Optional"
                  />
                </div>

                <div className="row" style={{ marginTop: 10 }}>
                  <label className="label">Amount</label>
                  <div className="grid three" style={{ gap: 10 }}>
                    <input
                      className="input"
                      value={debtAmount}
                      onChange={(e) => setDebtAmount(e.target.value)}
                      placeholder={debtCurrency === "USD" ? "Amount (USD)" : "Amount (LBP)"}
                    />
                    <button
                      className={`pill ${debtCurrency === "USD" ? "active" : ""}`}
                      type="button"
                      onClick={() => setDebtCurrency("USD")}
                    >
                      USD
                    </button>
                    <button
                      className={`pill ${debtCurrency === "LBP" ? "active" : ""}`}
                      type="button"
                      onClick={() => setDebtCurrency("LBP")}
                    >
                      LBP
                    </button>
                  </div>
                </div>

                <div className="row">
                  <label className="label">Note</label>
                  <input
                    className="input"
                    value={debtNote}
                    onChange={(e) => setDebtNote(e.target.value)}
                    placeholder="Optional"
                  />
                </div>

                <div className="divider" />

                <div className="sectionTitle" style={{ marginTop: 6 }}>
                  Latest debts on me
                </div>
                <div className="muted">Pending / Paid</div>

                <div style={{ marginTop: 10 }}>
                  {debtsOnMe.length === 0 ? <div className="muted">No debts on me yet.</div> : null}

                  {debtsOnMe.map((d) => {
                    const cur = (d.currency as any) || "USD";
                    const isPaid = (d.status || "pending") === "paid";
                    return (
                      <div key={d.id} className="saleRow">
                        <div>
                          <div className="saleTitle">
                            {d.person} • {isPaid ? "PAID ✅" : "PENDING ⏳"} • {cur}
                          </div>
                          <div className="saleSub">
                            {new Date(d.created_at).toLocaleString()}
                            {d.phone ? ` • ${d.phone}` : ""}
                            {d.note ? ` • ${d.note}` : ""}
                            {isPaid && d.paid_via ? ` • via ${String(d.paid_via).toUpperCase()}` : ""}
                          </div>
                        </div>

                        <div className="saleRight">
                          <div className="big">
                            {cur === "USD"
                              ? `$${Number(d.amount || 0).toFixed(2)}`
                              : `${Number(d.amount || 0).toLocaleString()} LBP`}
                          </div>

                          {!isPaid ? (
                            <div style={{ display: "flex", gap: 8 }}>
                              <button
                                className="btn"
                                type="button"
                                disabled={loading}
                                onClick={() => payDebtOnMe(d, "cash")}
                                title="Will create a payout (USD only)"
                              >
                                Pay Cash
                              </button>
                              <button
                                className="btn"
                                type="button"
                                disabled={loading}
                                onClick={() => payDebtOnMe(d, "wish")}
                                title="Will create a Wish receive (-)"
                              >
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
                {/* ✅ POS UI */}
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
                    <div
                      className="row"
                      style={{ marginTop: 14, display: "flex", justifyContent: "space-between" }}
                    >
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
                            After saving debt, WhatsApp opens directly with a ready message.
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div style={{ marginTop: 12 }} className="row">
                      <label className="label">Note (details)</label>
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
                  Array.isArray(s.items) && s.items.length
                    ? s.items.map((x: any) => `${x.qty || 1}x ${x.name}`).join(", ")
                    : "";

                return (
                  <div key={s.id} className="saleRow">
                    <div>
                      <div className="saleTitle">
                        {s.category} • {String(s.pay_type).toUpperCase()}
                      </div>
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

        {isManageOpen && !isWish && !isDebtOnMe ? (
          <ManageModal
            category={category as PosCategory}
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
        .grid.metrics { grid-template-columns: repeat(5, 1fr); }
        @media (max-width: 980px) { .grid.metrics { grid-template-columns: repeat(2, 1fr); } }
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
        .tiny { color: rgba(255,255,255,0.5); font-size: 12px; margin-top: 4px; }
        .cart { margin-top: 10px; display:flex; flex-direction: column; gap: 10px; }
        .cartRow { display:flex; justify-content: space-between; gap: 12px; padding: 12px; border-radius: 16px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
        .cartName { font-weight: 700; }
        .cartSub { font-size: 12px; opacity: 0.7; margin-top: 2px; }
        .cartControls { display:flex; align-items: center; gap: 10px; }
        .mini { display:flex; align-items: center; gap: 8px; }
        .miniLabel { font-size: 12px; opacity: 0.65; }
        .miniInput { width: 70px; padding: 8px 10px; border-radius: 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); color: white; }
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
          background: rgba(0, 0, 0, 0.55);
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
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
          padding: 16px;
        }
        .modalHeader {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }
        .modalTitle {
          font-size: 18px;
          font-weight: 800;
        }
        .modalSub {
          font-size: 12px;
          opacity: 0.7;
          margin-top: 2px;
        }
        .modalBody {
          margin-top: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .manageRow {
          display: grid;
          grid-template-columns: 1.4fr 0.6fr 0.4fr;
          gap: 10px;
        }
        .modalFooter {
          margin-top: 14px;
          display: flex;
          justify-content: space-between;
        }
        .input {
          width: 100%;
          padding: 10px 12px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: white;
        }
        .btn {
          padding: 10px 14px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.06);
          color: white;
          cursor: pointer;
        }
        .btn.primary {
          background: linear-gradient(90deg, rgba(59, 130, 246, 0.9), rgba(37, 99, 235, 0.9));
          border-color: rgba(59, 130, 246, 0.35);
        }
        .btn.danger {
          background: rgba(239, 68, 68, 0.12);
          border-color: rgba(239, 68, 68, 0.35);
        }
        .muted {
          color: rgba(255, 255, 255, 0.55);
          font-size: 13px;
        }
      `}</style>
    </div>
  );
}
