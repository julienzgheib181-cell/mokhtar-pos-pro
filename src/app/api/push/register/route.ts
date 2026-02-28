import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin"; // (service role)

export async function POST(req: Request) {
  const { token } = await req.json();
  if (!token) return NextResponse.json({ ok: false, error: "Missing token" }, { status: 400 });

  // خزّن/حدّث (حتى ما يتكرر)
  const { error } = await supabaseAdmin
    .from("push_tokens")
    .upsert({ token }, { onConflict: "token" });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}