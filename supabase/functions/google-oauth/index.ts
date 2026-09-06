// Forge — Google OAuth Edge Function (Deno, Supabase). Calendar + Gmail.
//
// Route authorization model (supabase/config.toml — verify_jwt=false at gateway):
//   prepare  : requires Supabase bearer JWT; creates one-time state + server PKCE verifier
//   proxy    : requires Supabase bearer JWT; Calendar/Gmail via stored token
//   callback : provider redirect; validates state, atomically marks used, exchanges code
//
// HARD SAFETY RULES (structural, not config):
//   · Gmail: only messages.list / messages.get / drafts.create are reachable.
//     users.messages.send is never called — Forge cannot send email.
//   · Calendar: events.insert only after client sends confirmed===true (explicit user
//     confirmation), with server-side payload validation and a duplicate guard.
//
// Token storage (P4/P5): AES-256-GCM via OAUTH_ENCRYPTION_KEY, base64 text blob.
import { createClient } from "npm:@supabase/supabase-js@2";
import { encryptToken, decryptToken, type StoredSecret } from "../_shared/token-crypto.ts";
import { isAllowedRedirect } from "../_shared/redirect.ts";
import { validateState, type StateRow } from "../_shared/oauth-state.ts";
import { buildMime, mimeToRaw } from "../_shared/mime.ts";

const SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose";
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
const redirectUri = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-oauth?op=callback`;

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function requireUser(req: Request) {
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!jwt) throw Object.assign(new Error("missing bearer token"), { status: 401 });
  const { data, error } = await serviceClient().auth.getUser(jwt);
  if (error || !data.user) throw Object.assign(new Error("invalid or expired session"), { status: 401 });
  return data.user;
}

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
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  await serviceClient().from("oauth_states").insert({
    state, user_id: user.id, provider: "google", pkce_verifier: verifier, redirect_to: redirect,
  });
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
  return json({ url: target.toString(), state });
}

async function callback(req: Request) {
  const url = new URL(req.url);
  const db = serviceClient();
  const presented = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  const { data: row } = presented
    ? await db.from("oauth_states").select("*").eq("state", presented).maybeSingle()
    : { data: null };
  const verdict = validateState(presented, (row as StateRow | null) ?? null, "google");

  const failRedirect = (reason: string) => {
    const dest = isAllowedRedirect(null, Deno.env.get("APP_ORIGIN")).url;
    const target = new URL(dest);
    target.searchParams.set("oauth", "google");
    target.searchParams.set("status", "error");
    target.searchParams.set("reason", reason);
    return new Response(null, { status: 302, headers: { ...cors, Location: target.toString() } });
  };
  if (!verdict.ok) return failRedirect(verdict.reason);
  if (!code) return failRedirect("missing_code");
  if (!verdict.row.pkce_verifier) return failRedirect("missing_pkce");

  const { error: useErr } = await db
    .from("oauth_states").update({ used: true }).eq("state", presented!).eq("used", false);
  if (useErr) return failRedirect("state_conflict");

  const ex = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      code,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      code_verifier: verdict.row.pkce_verifier,
    }),
  });
  const tok = await ex.json();
  if (!tok.access_token) return failRedirect("token_exchange_failed");

  await db.from("oauth_credentials").upsert(
    {
      user_id: verdict.row.user_id,
      provider: "google",
      access_token_enc: JSON.stringify(await encryptToken(tok.access_token, key())),
      refresh_token_enc: tok.refresh_token
        ? JSON.stringify(await encryptToken(tok.refresh_token, key()))
        : null,
      expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
    },
    { onConflict: "user_id,provider" },
  );
  await db.from("integrations").upsert(
    { user_id: verdict.row.user_id, provider: "google", status: "connected", scope: tok.scope ?? SCOPES },
    { onConflict: "user_id,provider" },
  );

  const back = new URL(verdict.row.redirect_to);
  back.searchParams.set("oauth", "google");
  back.searchParams.set("status", "ok");
  back.searchParams.set("state", presented!);
  return new Response(null, { status: 302, headers: { ...cors, Location: back.toString() } });
}

/** Live access token, transparently refreshed via refresh_token when expired. */
async function getValidToken(userId: string): Promise<string> {
  const db = serviceClient();
  const { data: cred } = await db.from("oauth_credentials").select("*")
    .eq("user_id", userId).eq("provider", "google").maybeSingle();
  if (!cred?.access_token_enc) throw Object.assign(new Error("google not connected"), { status: 412 });

  if (cred.expires_at && Date.parse(cred.expires_at) > Date.now() + 60_000) {
    return decryptToken(JSON.parse(cred.access_token_enc) as StoredSecret, key());
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
      refresh_token: await decryptToken(JSON.parse(cred.refresh_token_enc) as StoredSecret, key()),
      grant_type: "refresh_token",
    }),
  });
  const tok = await r.json();
  if (!tok.access_token) {
    await db.from("integrations").upsert({ user_id: userId, provider: "google", status: "revoked" }, { onConflict: "user_id,provider" });
    throw Object.assign(new Error("refresh rejected — token revoked by user"), { status: 401 });
  }
  await db.from("oauth_credentials").update({
    access_token_enc: JSON.stringify(await encryptToken(tok.access_token, key())),
    expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
  }).eq("user_id", userId).eq("provider", "google");
  return tok.access_token;
}

// ── P15: Calendar event payload validation ──
function validateEvent(ev: unknown): { summary: string; start: string; end: string; blockId: string; oppId: string } {
  const e = ev as Record<string, unknown>;
  const str = (k: string, max: number) => {
    if (typeof e[k] !== "string" || !e[k] || (e[k] as string).length > max) throw new Error(`invalid ${k}`);
    return e[k] as string;
  };
  const summary = str("summary", 300);
  const start = str("start", 40);
  const end = str("end", 40);
  const blockId = str("blockId", 120);
  const oppId = str("oppId", 120);
  const s = Date.parse(start), en = Date.parse(end);
  if (Number.isNaN(s) || Number.isNaN(en)) throw new Error("invalid timestamps");
  if (!(s < en)) throw new Error("start must be before end");
  const now = Date.now();
  if (s < now - 365 * 86_400_000) throw new Error("event too far in the past");
  if (s > now + 5 * 365 * 86_400_000) throw new Error("event too far in the future");
  if (en - s > 24 * 3_600_000) throw new Error("event longer than 24h");
  return { summary, start, end, blockId, oppId };
}

async function proxy(req: Request) {
  const user = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  const db = serviceClient();
  const token = await getValidToken(user.id);
  const g = (url: string, init?: RequestInit) =>
    fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });

  switch (body.action) {
    case "calendar_create": {
      if (body.confirmed !== true) return json({ error: "missing explicit user confirmation" }, 403);
      if (!Array.isArray(body.events) || body.events.length === 0 || body.events.length > 50)
        return json({ error: "batch must contain 1..50 events" }, 400);

      const results: { blockId: string; externalId?: string; error?: string }[] = [];
      for (const raw of body.events) {
        let ev;
        try {
          ev = validateEvent(raw);
        } catch (e) {
          results.push({ blockId: String((raw as any)?.blockId ?? "?"), error: (e as Error).message });
          continue;
        }
        // Duplicate guard BEFORE any external write: same block already linked?
        const { data: dup } = await db.from("calendar_links").select("external_id")
          .eq("user_id", user.id).eq("block_id", ev.blockId).maybeSingle();
        if (dup) { results.push({ blockId: ev.blockId, externalId: dup.external_id, error: "duplicate" }); continue; }

        const res = await g("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
          method: "POST",
          body: JSON.stringify({ summary: ev.summary, start: { dateTime: ev.start }, end: { dateTime: ev.end } }),
        });
        const created = await res.json();
        if (!created.id) { results.push({ blockId: ev.blockId, error: created.error?.message ?? "google rejected event" }); continue; }

        // Persist the link. If THIS fails after Google created the event, we must not
        // silently diverge: record a compensating row so the reconcile step can heal.
        const { error: linkErr } = await db.from("calendar_links").insert({
          user_id: user.id, opp_id: ev.oppId, block_id: ev.blockId,
          external_id: created.id, start_at: ev.start, summary: ev.summary,
        });
        if (linkErr) {
          await db.from("calendar_links").insert({
            user_id: user.id, opp_id: ev.oppId, block_id: `${ev.blockId}__orphan`,
            external_id: created.id, start_at: ev.start, summary: `[orphan:${ev.blockId}] ${ev.summary}`,
          }).catch(() => undefined);
          results.push({ blockId: ev.blockId, externalId: created.id, error: "linked_with_orphan_marker" });
        } else {
          results.push({ blockId: ev.blockId, externalId: created.id });
        }
      }
      return json({ results });
    }
    case "calendar_delete_link": {
      const blockId = String(body.blockId ?? "");
      await db.from("calendar_links").delete().eq("user_id", user.id).eq("block_id", blockId);
      return json({ ok: true });
    }

    case "gmail_list": {
      const orgs: string[] = Array.isArray(body.orgs) ? body.orgs.slice(0, 10).map((o) => String(o).replace(/"/g, "")) : [];
      const q = orgs.length ? orgs.map((o) => `"${o}"`).join(" OR ") : "newer_than:30d";
      const res = await g(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=20`);
      return json(await res.json());
    }
    case "gmail_get": {
      const id = encodeURIComponent(String(body.id ?? ""));
      const res = await g(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata`);
      return json(await res.json());
    }
    case "gmail_draft": {
      // P16: build MIME safely; never interpolate raw strings. Drafts only — no send.
      let mime: string;
      try {
        mime = buildMime({ to: String(body.to ?? ""), subject: String(body.subject ?? ""), body: String(body.body ?? "") });
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
      const res = await g("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
        method: "POST",
        body: JSON.stringify({ message: { raw: mimeToRaw(mime) } }),
      });
      const draft = await res.json();
      if (!draft.id) return json({ error: "draft creation failed", detail: draft.error?.message }, 502);
      return json({ draftId: draft.id });
    }

    case "revoke": {
      const { data: cred } = await db.from("oauth_credentials").select("*")
        .eq("user_id", user.id).eq("provider", "google").maybeSingle();
      if (cred?.access_token_enc) {
        const tok = await decryptToken(JSON.parse(cred.access_token_enc) as StoredSecret, key()).catch(() => null);
        if (tok) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok)}`, { method: "POST" });
        await db.from("oauth_credentials").delete().eq("user_id", user.id).eq("provider", "google");
      }
      await db.from("integrations").upsert({ user_id: user.id, provider: "google", status: "revoked" }, { onConflict: "user_id,provider" });
      return json({ ok: true });
    }
    case "status": {
      const { data } = await db.from("integrations").select("*").eq("user_id", user.id).eq("provider", "google").maybeSingle();
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
    return await proxy(req);
  } catch (e) {
    if (e instanceof Response) return e;
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: (e as Error).message }, status);
  }
});
