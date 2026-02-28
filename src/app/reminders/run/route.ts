import { NextResponse } from "next/server";
import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || "mailto:admin@mokhtarcell.local";
    if (!publicKey || !privateKey) {
      return NextResponse.json({ error: "Missing VAPID keys" }, { status: 500 });
    }
    webpush.setVapidDetails(subject, publicKey, privateKey);

    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    const { data: dueDebts, error } = await supabase
      .from("debts")
      .select("id,customer_name,customer_phone,amount,due_at,due_date")
      .eq("status", "pending")
      .is("reminded_at", null)
      .not("due_at", "is", null)
      .lte("due_at", now)
      .limit(100);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (!dueDebts || dueDebts.length === 0) {
      return NextResponse.json({ ok: true, sent: 0 });
    }

    const { data: subs, error: subErr } = await supabase
      .from("push_tokens")
      .select("endpoint,p256dh,auth");
    if (subErr) return NextResponse.json({ error: subErr.message }, { status: 500 });

    const results: any[] = [];

    for (const debt of dueDebts as any[]) {
      const payload = JSON.stringify({
        title: "Debt Due",
        body: `${debt.customer_name} • $${Number(debt.amount || 0).toFixed(2)} • Due now`,
        url: "/reminders",
      });

      for (const s of (subs ?? []) as any[]) {
        const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
        try {
          await webpush.sendNotification(subscription, payload);
        } catch (err: any) {
          const code = err?.statusCode;
          if (code === 404 || code === 410) {
            await supabase.from("push_tokens").delete().eq("endpoint", s.endpoint);
          }
        }
      }

      await supabase.from("debts").update({ reminded_at: now }).eq("id", debt.id);
      results.push({ id: debt.id });
    }

    return NextResponse.json({ ok: true, sent: results.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "run_failed" }, { status: 500 });
  }
}
