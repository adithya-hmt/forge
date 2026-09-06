// ─── Client-side OAuth orchestration ────────────────────────────────────────
// Secrets and tokens NEVER touch this layer:
//   · prepare  → authenticated Edge Function call creates one-time state (+PKCE)
//   · start    → browser navigates; only the unguessable state travels in the URL
//   · callback → server validates state, exchanges code, encrypts tokens at rest
//   · proxy    → every provider API call is made server-side with the stored token
// The client verifies the returned state against what `prepare` issued before
// trusting a "connected" status.

import { getSupabase } from "./supabase";

export type Provider = "github" | "google";

const pending = new Map<Provider, string>(); // provider → expected state

export async function startOAuth(provider: Provider): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "Supabase is not configured — OAuth runs via Edge Functions and needs VITE_SUPABASE_URL/ANON_KEY plus server secrets." };
  const { data: user } = await sb.auth.getUser();
  if (!user.user) return { ok: false, error: "Sign in with a Forge account first (Settings → Account) — OAuth state is bound to your user id." };
  const { data, error } = await sb.functions.invoke(`${provider}-oauth?op=prepare`, {
    body: { redirect: window.location.origin + window.location.pathname },
  });
  if (error || !data?.url || !data?.state) return { ok: false, error: `prepare failed: ${error?.message ?? "no authorize url"}` };
  pending.set(provider, data.state as string);
  try { sessionStorage.setItem(`forge-oauth-state-${provider}`, data.state as string); } catch { /* tab restore only */ }
  window.location.assign(data.url as string);
  return { ok: true };
}

/** Read ?oauth=…&status=…&state=… from the return navigation; validates state. */
export function consumeOAuthReturn(): { provider: Provider; status: string; validState: boolean } | null {
  const params = new URLSearchParams(window.location.search);
  const provider = params.get("oauth") as Provider | null;
  if (!provider || (provider !== "github" && provider !== "google")) return null;
  const status = params.get("status") ?? "unknown";
  const returned = params.get("state") ?? "";
  let expected: string | null = pending.get(provider) ?? null;
  try { expected ??= sessionStorage.getItem(`forge-oauth-state-${provider}`); } catch { /* ignore */ }
  try { sessionStorage.removeItem(`forge-oauth-state-${provider}`); } catch { /* ignore */ }
  // Clean the URL without a reload.
  params.delete("oauth"); params.delete("status"); params.delete("state");
  const rest = params.toString();
  window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
  return { provider, status, validState: Boolean(expected) && expected === returned };
}

export async function providerCall<T = unknown>(provider: Provider, body: Record<string, unknown>): Promise<T> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data, error } = await sb.functions.invoke(`${provider}-oauth`, { body });
  if (error) throw new Error(`${provider} call failed: ${error.message}`);
  const d = data as T & { error?: string };
  if (d && typeof d === "object" && "error" in d && d.error) throw new Error(String(d.error));
  return data as T;
}

export async function revokeProvider(provider: Provider): Promise<void> {
  if (provider === "google") await providerCall("google", { action: "revoke" });
  // GitHub tokens: delete the stored credential row via the integrations API surface.
  const sb = getSupabase();
  const { data: user } = await sb!.auth.getUser();
  if (user.user) {
    await sb!.from("integrations").upsert({ user_id: user.user.id, provider, status: "revoked" }, { onConflict: "user_id,provider" });
  }
}
