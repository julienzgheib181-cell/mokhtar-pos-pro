export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const token = body?.token;

    if (!token) {
      return NextResponse.json({ ok: false, error: "No token" });
    }

    const { error } = await supabaseAdmin
      .from("push_tokens")
      .upsert({ token }, { onConflict: "token" });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}