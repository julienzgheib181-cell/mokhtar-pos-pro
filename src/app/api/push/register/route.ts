import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Stores a Web Push subscription.
 * Expects JSON body: { subscription: PushSubscription }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const subscription = body?.subscription;

    if (!subscription?.endpoint) {
      return NextResponse.json({ error: "Missing subscription" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Table: push_tokens
    // Columns: endpoint (text, unique), p256dh (text), auth (text), created_at (timestamptz)
    const endpoint = String(subscription.endpoint);
    const p256dh = String(subscription?.keys?.p256dh ?? "");
    const auth = String(subscription?.keys?.auth ?? "");

    const { error } = await supabase
      .from("push_tokens")
      .upsert(
        [{ endpoint, p256dh, auth }],
        { onConflict: "endpoint" }
      );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "register_failed" }, { status: 500 });
  }
}
