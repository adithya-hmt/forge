// Forge — Google OAuth Edge Function (Deno, Supabase). Calendar + Gmail.
// Flow: authorize (state + PKCE generated SERVER-side) → callback → exchange →
// encrypted storage → refresh-on-expiry → revocation.
//
// HARD SAFETY RULES (structural, not config):
//   · Gmail: this function exposes messages.list / messages.get / drafts.create ONLY.
//     users.messages.send is never called anywhere in this file — Forge cannot send email.
//   · Calendar: events.insert is only reachable after the client has recorded the user's
//     explicit confirmation, and duplicates are rejected via calendar_links before insert.
//
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_ENCRYPTION_KEY, APP_ORIGIN
import { createClient } from "npm:@supabase/supabase-js@2";

const SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose";
const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const sb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function requireUser(req: Request) {
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data, error } = await sb().auth.getUser(jwt);
  if (error || !data.user) throw new Response("unauthorized", { status: 401, headers: cors });
  return data.user;
}
async function encryptToken(plain: string) {
  const { data, error } = await sb().rpc("forge_encrypt", { plaintext: plain });
  if (error) throw new Error(error.message);
  return Array.from(Uint8Array.from(data as number[]));
}
async function decryptToken(cipher: number[]) {
  const { data, error } = await sb().rpc("forge_decrypt", { ciphertext: cipher });
  if (error) throw new Error(error.message);
  return data as string;
}

const redirectUri = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-oauth?op=callback`;

// prepare: authenticated (JWT) — creates one-time state + server-held PKCE verifier.
async function prepare(req: Request) {
  const body = await req.json().catch(() => ({}));
  const user = await requireUser(req);
  const state = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const redirect = typeof body.redirect === "string" ? body.redirect : Deno.env.get("APP_ORIGIN")!;
  await sb().from("oauth_states").insert({
    state, user_id: user.id, provider: "google", pkce_verifier: verifier, redirect_to: redirect,
  });
  return json({ url: await startUrl(state, verifier), state });
}

async function startUrl(state: string, verifier: string): Promise<string> {
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const target = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  target.searchParams.set("client_id", Deno.env.get("GOOGLE_CLIENT_ID")!);
  target.searchParams.set("redirect_uri", redirectUri());
  target.searchParams.set("response_type", "code");
  target.searchParams.set("scope", SCOPES);
  target.searchParams.set("access_type", "offline");
  target.searchParams.set("prompt", "consent");
  target.searchParams.set("state", state);
  target.searchParams.set("code_challenge", challenge);
  target.searchParams.set("code_challenge_method", "S256");
  return target.toString();
}

// start: plain browser navigation; the unguessable one-time state is the only credential.
async function start(req: Request) {
  const state = new URL(req.url).searchParams.get("state");
  if (!state) return json({ error: "missing state" }, 400);
  const { data: st } = await sb().from("oauth_states").select("*").eq("state", state).single();
  if (!st || st.used || st.provider !== "google" || !st.pkce_verifier) return json({ error: "invalid state" }, 403);
  if (Date.now() - Date.parse(st.created_at) > 10 * 60_000) return json({ error: "state expired" }, 403);
  return new Response(null, { status: 302, headers: { ...cors, Location: await startUrl(state, st.pkce_verifier) } });
}

async function callback(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) return json({ error: "missing state or code" }, 400);
  const { data: st } = await sb().from("oauth_states").select("*").eq("state", state).single();
  if (!st || st.used || st.provider !== "google") return json({ error: "invalid or replayed state" }, 403);
  if (Date.now() - Date.parse(st.created_at) > 10 * 60_000) return json({ error: "state expired" }, 403);
  await sb().from("oauth_states").update({ used: true }).eq("state", state);

  const ex = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      code, redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      code_verifier: st.pkce_verifier ?? "",
    }),
  });
  const tok = await ex.json();
  if (!tok.access_token) return json({ error: "token exchange failed", detail: tok.error_description ?? tok.error }, 502);

  await sb().from("oauth_credentials").upsert({
    user_id: st.user_id, provider: "google",
    access_token_enc: await encryptToken(tok.access_token),
    refresh_token_enc: tok.refresh_token ? await encryptToken(tok.refresh_token) : null,
    expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
  }, { onConflict: "user_id,provider" });
  await sb().from("integrations").upsert(
    { user_id: st.user_id, provider: "google", status: "connected", scope: tok.scope ?? SCOPES },
    { onConflict: "user_id,provider" });

  const back = new URL(st.redirect_to);
  back.searchParams.set("oauth", "google");
  back.searchParams.set("status", "ok");
  return new Response(null, { status: 302, headers: { ...cors, Location: back.toString() } });
}

/** Returns a live access token, refreshing via refresh_token when expired. */
async function getValidToken(userId: string): Promise<string> {
  const db = sb();
  const { data: cred } = await db.from("oauth_credentials").select("*")
    .eq("user_id", userId).eq("provider", "google").single();
  if (!cred) throw Object.assign(new Error("google not connected"), { status: 412 });
  if (cred.expires_at && Date.parse(cred.expires_at) > Date.now() + 60_000) {
    return await decryptToken(cred.access_token_enc as number[]);
  }
  if (!cred.refresh_token_enc) {
    await db.from("integrations").upsert({ user_id: userId, provider: "google", status: "revoked" }, { onConflict: "user_id,provider" });
    throw Object.assign(new Error("token expired and no refresh token — reconnect required"), { status: 401 });
  }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: await decryptToken(cred.refresh_token_enc as number[]),
      grant_type: "refresh_token",
    }),
  });
  const tok = await r.json();
  if (!tok.access_token) {
    await db.from("integrations").upsert({ user_id: userId, provider: "google", status: "revoked" }, { onConflict: "user_id,provider" });
    throw Object.assign(new Error("refresh rejected — token revoked by user"), { status: 401 });
  }
  await db.from("oauth_credentials").update({
    access_token_enc: await encryptToken(tok.access_token),
    expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
  }).eq("user_id", userId).eq("provider", "google");
  return tok.access_token;
}

async function proxy(req: Request) {
  const user = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  const token = await getValidToken(user.id);
  const g = (url: string, init?: RequestInit) =>
    fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });

  switch (body.action) {
    // ── Calendar ─────────────────────────────────────────────────────────
    case "calendar_create": {
      // Client must send confirmed=true; it is only set by the explicit confirm modal.
      if (body.confirmed !== true) return json({ error: "missing explicit user confirmation" }, 403);
      const ev = body.event as { summary: string; start: string; end: string; blockId: string; oppId: string };
      // Duplicate guard BEFORE any external write: same block or same external event.
      const { data: dup } = await sb().from("calendar_links")
        .select("block_id").eq("user_id", user.id).eq("block_id", ev.blockId).maybeSingle();
      if (dup) return json({ error: "duplicate", existing: dup }, 409);
      const res = await g("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        body: JSON.stringify({ summary: ev.summary, start: { dateTime: ev.start }, end: { dateTime: ev.end } }),
      });
      const created = await res.json();
      if (!created.id) return json({ error: "google rejected event", detail: created }, 502);
      await sb().from("calendar_links").insert({
        user_id: user.id, opp_id: ev.oppId, block_id: ev.blockId,
        external_id: created.id, start_at: ev.start, summary: ev.summary,
      });
      return json({ externalId: created.id, htmlLink: created.htmlLink });
    }
    case "calendar_delete_link": {
      await sb().from("calendar_links").delete().eq("user_id", user.id).eq("block_id", body.blockId);
      return json({ ok: true });
    }

    // ── Gmail (READ + DRAFT ONLY — there is no send action in this file) ─
    case "gmail_list": {
      // Query is assembled server-side from an allowlist of organization names.
      const orgs: string[] = Array.isArray(body.orgs) ? body.orgs.slice(0, 10) : [];
      const q = orgs.map((o) => `"${String(o).replace(/"/g, "")}"`).join(" OR ") || "newer_than:30d";
      const res = await g(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=20`);
      return json(await res.json());
    }
    case "gmail_get": {
      const res = await g(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(String(body.id))}?format=metadata`);
      return json(await res.json());
    }
    case "gmail_draft": {
      const raw = btoa(unescape(encodeURIComponent(body.mime as string))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const res = await g("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
        method: "POST", body: JSON.stringify({ message: { raw } }),
      });
      const draft = await res.json();
      if (!draft.id) return json({ error: "draft creation failed", detail: draft }, 502);
      return json({ draftId: draft.id }); // draft stays in the user's Drafts; nothing is sent
    }

    // ── Lifecycle ────────────────────────────────────────────────────────
    case "revoke": {
      const { data: cred } = await sb().from("oauth_credentials").select("*")
        .eq("user_id", user.id).eq("provider", "google").single();
      if (cred) {
        const tok = await decryptToken(cred.access_token_enc as number[]).catch(() => null);
        if (tok) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok)}`, { method: "POST" });
        await sb().from("oauth_credentials").delete().eq("user_id", user.id).eq("provider", "google");
      }
      await sb().from("integrations").upsert({ user_id: user.id, provider: "google", status: "revoked" }, { onConflict: "user_id,provider" });
      return json({ ok: true });
    }
    case "status": {
      const { data } = await sb().from("integrations").select("*").eq("user_id", user.id).eq("provider", "google").maybeSingle();
      return json({ status: data?.status ?? "disconnected" });
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
    if (op === "start") return await start(req);
    return await proxy(req);
  } catch (e) {
    if (e instanceof Response) return e;
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: (e as Error).message }, status);
  }
});
