export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAdminMessaging } from "@/lib/firebaseAdmin";

export async function POST(req: Request) {
  try {
    const { title, body } = (await req.json().catch(() => ({}))) as { title?: string; body?: string };

    const { data, error } = await supabaseAdmin.from("push_tokens").select("token");
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const tokens = (data ?? []).map((x: any) => x.token).filter(Boolean);
    if (!tokens.length) return NextResponse.json({ ok: false, error: "No tokens registered" }, { status: 400 });

    const messaging = getAdminMessaging();

    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: title ?? "Mokhtar Cell",
        body: body ?? "Test notification ✅",
      },
      data: { click_action: "/" },
    });

    // cleanup invalid tokens
    const badTokens: string[] = [];
    res.responses.forEach((r, i) => {
      if (!r.success) badTokens.push(tokens[i]);
    });
    if (badTokens.length) {
      await supabaseAdmin.from("push_tokens").delete().in("token", badTokens);
    }

    return NextResponse.json({ ok: true, successCount: res.successCount, failureCount: res.failureCount });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
