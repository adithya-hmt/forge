// Forge — GitHub OAuth Edge Function (Deno, Supabase).
//
// Route authorization model (see supabase/config.toml — verify_jwt=false at gateway):
//   prepare  : requires a valid Supabase bearer JWT (manually verified) — creates state
//   proxy    : requires a valid Supabase bearer JWT — authenticated GitHub API calls
//   start    : browser navigation; only the unguessable one-time `state` is required
//   callback : provider redirect; validates state, atomically marks used, exchanges code
//
// Token storage (P4/P5): AES-256-GCM via OAUTH_ENCRYPTION_KEY (function secret),
// serialized as a base64 text blob. Never number[]/bytea. Never Vault.
import { createClient } from "npm:@supabase/supabase-js@2";
import { encryptToken, decryptToken, type StoredSecret } from "../_shared/token-crypto.ts";
import { isAllowedRedirect } from "../_shared/redirect.ts";
import { validateState, type StateRow } from "../_shared/oauth-state.ts";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const serviceClient = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const key = () => Deno.env.get("OAUTH_ENCRYPTION_KEY") ?? "";
const redirectUri = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/github-oauth?op=callback`;

async function requireUser(req: Request) {
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!jwt) throw Object.assign(new Error("missing bearer token"), { status: 401 });
  const { data, error } = await serviceClient().auth.getUser(jwt);
  if (error || !data.user) throw Object.assign(new Error("invalid or expired session"), { status: 401 });
  return data.user;
}

// ── prepare: authenticated. Creates one-time state. Returns authorize URL. ──
async function prepare(req: Request) {
  const user = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  const redirect = isAllowedRedirect(
    typeof body.redirect === "string" ? body.redirect : null,
    Deno.env.get("APP_ORIGIN"),
    Deno.env.get("EXTRA_ORIGINS"),
    { allowLocalhost: Deno.env.get("ALLOW_LOCALHOST") === "1" },
  ).url;
  const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await serviceClient().from("oauth_states").insert({
    state, user_id: user.id, provider: "github", pkce_verifier: null, redirect_to: redirect,
  });
  const target = new URL("https://github.com/login/oauth/authorize");
  target.searchParams.set("client_id", Deno.env.get("GITHUB_CLIENT_ID")!);
  target.searchParams.set("redirect_uri", redirectUri());
  target.searchParams.set("state", state);
  target.searchParams.set("scope", "read:user repo");
  return json({ url: target.toString(), state });
}

// ── callback: provider redirect. No JWT available. State is the credential. ──
async function callback(req: Request) {
  const url = new URL(req.url);
  const db = serviceClient();
  const presented = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  const { data: row } = presented
    ? await db.from("oauth_states").select("*").eq("state", presented).maybeSingle()
    : { data: null };
  const verdict = validateState(presented, (row as StateRow | null) ?? null, "github");

  const failRedirect = (reason: string) => {
    const dest = isAllowedRedirect(null, Deno.env.get("APP_ORIGIN")).url;
    const target = new URL(dest);
    target.searchParams.set("oauth", "github");
    target.searchParams.set("status", "error");
    target.searchParams.set("reason", reason);
    return new Response(null, { status: 302, headers: { ...cors, Location: target.toString() } });
  };
  if (!verdict.ok) return failRedirect(verdict.reason);
  if (!code) return failRedirect("missing_code");

  // Atomically mark used. If another request already consumed it, abort (replay).
  const { error: useErr } = await db
    .from("oauth_states")
    .update({ used: true })
    .eq("state", presented!)
    .eq("used", false);
  if (useErr) return failRedirect("state_conflict");

  // Exchange code → token (server-to-server; secret never leaves this function).
  const ex = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: Deno.env.get("GITHUB_CLIENT_ID"),
      client_secret: Deno.env.get("GITHUB_CLIENT_SECRET"),
      code,
      redirect_uri: redirectUri(),
    }),
  });
  const tok = await ex.json();
  if (!tok.access_token) return failRedirect("token_exchange_failed");

  const stored = await encryptToken(tok.access_token, key());
  await db.from("oauth_credentials").upsert(
    {
      user_id: verdict.row.user_id,
      provider: "github",
      access_token_enc: JSON.stringify(stored),
      refresh_token_enc: null,
      expires_at: null, // GitHub tokens do not expire by default
    },
    { onConflict: "user_id,provider" },
  );
  await db.from("integrations").upsert(
    { user_id: verdict.row.user_id, provider: "github", status: "connected", scope: "read:user repo" },
    { onConflict: "user_id,provider" },
  );

  // P2: redirect back to the validated origin, echoing the validated state so the
  // client can confirm completion against its locally stored expectation.
  const back = new URL(verdict.row.redirect_to);
  back.searchParams.set("oauth", "github");
  back.searchParams.set("status", "ok");
  back.searchParams.set("state", presented!);
  return new Response(null, { status: 302, headers: { ...cors, Location: back.toString() } });
}

// ── proxy: authenticated GitHub API calls with the stored (decrypted) token. ──
async function proxy(req: Request) {
  const user = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  const db = serviceClient();

  const { data: cred } = await db
    .from("oauth_credentials").select("*")
    .eq("user_id", user.id).eq("provider", "github").maybeSingle();
  if (!cred?.access_token_enc) throw Object.assign(new Error("github not connected"), { status: 412 });
  const token = await decryptToken(JSON.parse(cred.access_token_enc) as StoredSecret, key());

  const gh = async (path: string) => {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (res.status === 401) throw Object.assign(new Error("github token revoked — reconnect"), { status: 401 });
    if (res.status === 403 || res.status === 429) throw Object.assign(new Error("github rate limited"), { status: 429 });
    if (!res.ok) throw Object.assign(new Error(`github ${res.status}`), { status: 502 });
    return res.json();
  };

  switch (body.action) {
    case "me":
      return json(await gh("/user"));
    // P14: sync the user's repos (public + permitted private) without downloading
    // source. Returns metadata only; the client chooses which to analyze.
    case "repos": {
      const repos = await gh("/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator");
      const slim = (Array.isArray(repos) ? repos : []).map((r: any) => ({
        name: r.name,
        full_name: r.full_name,
        html_url: r.html_url,
        description: r.description ?? "",
        private: r.private,
        language: r.language,
        size_kb: r.size,
        pushed_at: r.pushed_at,
        stars: r.stargazers_count,
        topics: r.topics ?? [],
        fork: r.fork,
      }));
      // Persist sync timestamp + metadata (service-role; user-scoped by RLS).
      await db.from("integrations").upsert(
        { user_id: user.id, provider: "github", status: "connected", meta: { last_sync: new Date().toISOString(), repo_count: slim.length } },
        { onConflict: "user_id,provider" },
      );
      return json({ repos: slim, synced_at: new Date().toISOString() });
    }
    case "languages": {
      const full = String(body.repo ?? "");
      if (!/^[\w.-]+\/[\w.-]+$/.test(full)) throw Object.assign(new Error("invalid repo"), { status: 400 });
      return json(await gh(`/repos/${full}/languages`));
    }
    case "revoke": {
      await db.from("oauth_credentials").delete().eq("user_id", user.id).eq("provider", "github");
      await db.from("integrations").upsert(
        { user_id: user.id, provider: "github", status: "revoked" },
        { onConflict: "user_id,provider" },
      );
      return json({ ok: true });
    }
    case "status": {
      const { data } = await db.from("integrations").select("*").eq("user_id", user.id).eq("provider", "github").maybeSingle();
      return json({ status: data?.status ?? "disconnected", meta: data?.meta ?? {} });
    }
    default:
      return json({ error: `unknown action ${body.action}` }, 400);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const op = new URL(req.url).searchParams.get("op");
    if (op === "callback") return await callback(req);
    if (op === "prepare") return await prepare(req);
    return await proxy(req);
  } catch (e) {
    if (e instanceof Response) return e;
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: (e as Error).message }, status);
  }
});
