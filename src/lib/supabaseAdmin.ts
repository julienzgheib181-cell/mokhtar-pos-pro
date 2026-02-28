import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("SUPABASE_URL is required");
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

export const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});
