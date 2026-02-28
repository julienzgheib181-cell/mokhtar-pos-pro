import { createClient } from "@supabase/supabase-js";

// Client-side singleton (works in "use client" components)
export const supabase = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // In Next.js, envs are injected at build/runtime. If missing, keep it null and throw when used.
  if (!url || !anon) {
    return null as any;
  }

  return createClient(url, anon, {
    auth: { persistSession: false },
  });
})();

export function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createClient(url, anon, {
    auth: { persistSession: false },
  });
}
