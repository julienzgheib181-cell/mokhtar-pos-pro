import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { admin } from "@/lib/firebaseAdmin"; // init admin once

export async function POST(req: Request) {
  const { title, body } = await req.json();

  const { data, error } = await supabaseAdmin.from("push_tokens").select("token");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const tokens = (data ?? []).map(x => x.token);
  if (!tokens.length) return NextResponse.json({ ok: false, error: "No tokens registered" });

  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title: title ?? "Mokhtar POS", body: body ?? "New activity" },
  });

  return NextResponse.json({ ok: true, sent: res.successCount, failed: res.failureCount });
}