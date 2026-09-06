import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Supabase is OPTIONAL at runtime. Unconfigured ⇒ the app runs in clearly
// labeled session-only mode; nothing silently pretends to persist.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured: boolean = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured || !url || !anonKey) return null;
  if (!client) client = createClient(url, anonKey, { auth: { persistSession: true } });
  return client;
}
