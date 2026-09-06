// Forge — GitHub OAuth Edge Function (Deno, Supabase).
// authorize → callback(state validation) → token exchange → encrypted storage →
// authenticated proxy → repository sync. Client secrets live ONLY in Supabase secrets.
//
// Required secrets: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, OAUTH_ENCRYPTION_KEY, APP_ORIGIN
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function sb() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function encryptToken(plain: string): Promise<Uint8Array> {
  // pgp_sym_encrypt executed IN the database via SECURITY DEFINER rpc; the key never leaves Vault.
  const { data, error } = await sb().rpc("forge_encrypt", { plaintext: plain });
  if (error) throw new Error(`encryption failed: ${error.message}`);
  return Uint8Array.from(data as number[]);
}
async function decryptToken(cipher: Uint8Array): Promise<string> {
  const { data, error } = await sb().rpc("forge_decrypt", { ciphertext: Array.from(cipher) });
  if (error) throw new Error(`decryption failed: ${error.message}`);
  return data as string;
}

async function requireUser(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.replace("Bearer ", "");
  const { data, error } = await sb().auth.getUser(jwt);
  if (error || !data.user) throw new Response("unauthorized", { status: 401, headers: cors });
  return data.user;
}

// prepare: authenticated (JWT) — creates the one-time state row server-side.
async function prepare(req: Request) {
  const body = await req.json().catch(() => ({}));
  const user = await requireUser(req);
  const state = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  const redirect = typeof body.redirect === "string" ? body.redirect : Deno.env.get("APP_ORIGIN")!;
  await sb().from("oauth_states").insert({
    state, user_id: user.id, provider: "github", pkce_verifier: null, redirect_to: redirect,
  });
  return json({ url: startUrl(state), state });
}

function startUrl(state: string): string {
  const target = new URL("https://github.com/login/oauth/authorize");
  target.searchParams.set("client_id", Deno.env.get("GITHUB_CLIENT_ID")!);
  target.searchParams.set("redirect_uri", `${Deno.env.get("SUPABASE_URL")}/functions/v1/github-oauth?op=callback`);
  target.searchParams.set("state", state);
  target.searchParams.set("scope", "read:user repo");
  return target.toString();
}

// start: plain browser navigation — the unguessable one-time state is the only credential.
async function start(req: Request) {
  const state = new URL(req.url).searchParams.get("state");
  if (!state) return json({ error: "missing state" }, 400);
  const { data: st } = await sb().from("oauth_states").select("*").eq("state", state).single();
  if (!st || st.used || st.provider !== "github") return json({ error: "invalid state" }, 403);
  if (Date.now() - Date.parse(st.created_at) > 10 * 60_000) return json({ error: "state expired" }, 403);
  return new Response(null, { status: 302, headers: { ...cors, Location: startUrl(state) } });
}

async function callback(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) return json({ error: "missing state or code" }, 400);

  const { data: st } = await sb().from("oauth_states").select("*").eq("state", state).single();
  if (!st || st.used || st.provider !== "github") return json({ error: "invalid or replayed state" }, 403);
  if (Date.now() - Date.parse(st.created_at) > 10 * 60_000) return json({ error: "state expired" }, 403);
  await sb().from("oauth_states").update({ used: true }).eq("state", state);

  const ex = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: Deno.env.get("GITHUB_CLIENT_ID"),
      client_secret: Deno.env.get("GITHUB_CLIENT_SECRET"),
      code, state,
      redirect_uri: `${Deno.env.get("SUPABASE_URL")}/functions/v1/github-oauth?op=callback`,
    }),
  });
  const tok = await ex.json();
  if (!tok.access_token) return json({ error: "token exchange failed", detail: tok.error_description ?? tok.error }, 502);

  const access = await encryptToken(tok.access_token);
  await sb().from("oauth_credentials").upsert({
    user_id: st.user_id, provider: "github",
    access_token_enc: Array.from(access),
    refresh_token_enc: null,
    expires_at: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000).toISOString() : null,
  }, { onConflict: "user_id,provider" });
  await sb().from("integrations").upsert({ user_id: st.user_id, provider: "github", status: "connected" }, { onConflict: "user_id,provider" });

  const back = new URL(st.redirect_to);
  back.searchParams.set("oauth", "github");
  back.searchParams.set("status", "ok");
  return new Response(null, { status: 302, headers: { ...cors, Location: back.toString() } });
}

async function proxy(req: Request) {
  const user = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  const { data: cred } = await sb().from("oauth_credentials")
    .select("*").eq("user_id", user.id).eq("provider", "github").single();
  if (!cred) return json({ error: "github not connected" }, 412);
  const token = await decryptToken(Uint8Array.from(cred.access_token_enc as number[]));

  const gh = (path: string) =>
    fetch(`https://api.github.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });

  if (action === "sync_repos") {
    const me = await gh("/user"); if (me.status === 401) return json({ error: "token revoked or expired — reconnect" }, 401);
    const profile = await me.json();
    const repos = await (await gh(`/user/repos?per_page=100&sort=updated&affiliation=owner`)).json();
    return json({ login: profile.login, name: profile.name, repos });
  }
  return json({ error: `unknown action ${action}` }, 400);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const op = new URL(req.url).searchParams.get("op");
    if (op === "callback") return await callback(req);
    if (op === "prepare") return await prepare(req);
    if (op === "start") return await start(req);
    return await proxy(req);
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: (e as Error).message }, 500);
  }
});
