import { NextResponse } from "next/server";
import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Sends a push notification to all saved subscriptions.
 * Body: { title?: string, body?: string }
 *
 * Required env vars:
 * - NEXT_PUBLIC_VAPID_PUBLIC_KEY
 * - VAPID_PRIVATE_KEY
 * Optional:
 * - VAPID_SUBJECT (default: mailto:admin@mokhtarcell.local)
 */
export async function POST(req: Request) {
  try {
    const { title, body } = await req.json().catch(() => ({ title: "", body: "" }));

    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || "mailto:admin@mokhtarcell.local";

    if (!publicKey || !privateKey) {
      return NextResponse.json(
        { error: "Missing VAPID keys (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)" },
        { status: 500 }
      );
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("push_tokens")
      .select("endpoint,p256dh,auth");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const payload = JSON.stringify({
      title: title || "Mokhtar Cell",
      body: body || "Update",
    });

    const subs = (data ?? []) as Array<{ endpoint: string; p256dh: string; auth: string }>;
    const results: any[] = [];

    for (const s of subs) {
      const subscription = {
        endpoint: s.endpoint,
        keys: {
          p256dh: s.p256dh,
          auth: s.auth,
        },
      };

      try {
        await webpush.sendNotification(subscription as any, payload);
        results.push({ endpoint: s.endpoint, ok: true });
      } catch (err: any) {
        // If subscription expired, remove it
        const code = err?.statusCode;
        if (code === 404 || code === 410) {
            await supabase.from("push_tokens").delete().eq("endpoint", s.endpoint);
        }
        results.push({ endpoint: s.endpoint, ok: false, error: err?.message ?? String(err) });
      }
    }

    return NextResponse.json({ ok: true, sent: results.length, results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "send_failed" }, { status: 500 });
  }
}
