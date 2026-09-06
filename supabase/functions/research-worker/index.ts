// Forge — server-side research worker (Deno, Supabase).
//
// Durable job execution (P10): jobs live in research_jobs. This worker claims a job
// atomically via the forge_job_claim() SQL function (FOR UPDATE SKIP LOCKED), so two
// workers can NEVER execute the same logical job. A crashed worker's lease expires
// (lease_expires_at) and the job becomes claimable again, up to max_attempts.
// Idempotency is enforced by the unique (user_id, idempotency_key) constraint and by
// the claim returning the already-completed result when a duplicate is enqueued.
//
// Fetch safety (P11): every outbound URL is validated by the SSRF guard (provider
// allowlist + private-range blocking) BEFORE fetch, with timeout + size limits.
//
// Invocation: authenticated (JWT) enqueue, OR a scheduler calling with the worker
// secret. This function never trusts the browser to run research.
import { createClient } from "npm:@supabase/supabase-js@2";
import { validateFetchUrl } from "../_shared/ssrf.ts";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const serviceClient = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2_000_000; // 2 MB

async function requireCaller(req: Request): Promise<string> {
  // Either a valid user JWT (enqueue own job) or the worker secret (scheduler).
  const workerSecret = Deno.env.get("RESEARCH_WORKER_SECRET");
  if (workerSecret && req.headers.get("x-worker-secret") === workerSecret) return "worker";
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!jwt) throw Object.assign(new Error("unauthorized"), { status: 401 });
  const { data, error } = await serviceClient().auth.getUser(jwt);
  if (error || !data.user) throw Object.assign(new Error("invalid session"), { status: 401 });
  return data.user.id;
}

/** SSRF-safe fetch with timeout and size cap. Returns text + retrieval metadata. */
async function safeFetch(url: string): Promise<{ text: string; retrievedAt: number; status: number }> {
  const verdict = validateFetchUrl(url);
  if (!verdict.ok) throw new Error(`blocked url (${verdict.reason}): ${url}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(verdict.normalized, {
      signal: controller.signal,
      headers: { "User-Agent": "ForgeResearchBot/1.0 (+https://forge.example.com)" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`upstream ${res.status} for ${verdict.normalized}`);
    const ct = res.headers.get("content-type") ?? "";
    if (!/json|text|html|xml/.test(ct)) throw new Error(`unexpected content-type ${ct}`);

    // Enforce size limit while streaming.
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no response body");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value?.length ?? 0;
      if (total > MAX_RESPONSE_BYTES) throw new Error("response too large");
      if (value) chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    return { text: new TextDecoder().decode(merged), retrievedAt: Date.now(), status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

// Claim one due job atomically. Returns null when the queue is empty.
async function claimJob(): Promise<any | null> {
  const { data, error } = await serviceClient().rpc("forge_job_claim", { p_worker: Deno.deployId ?? "worker" });
  if (error) throw new Error(`claim failed: ${error.message}`);
  return data ?? null;
}

async function executeJob(job: any): Promise<void> {
  const db = serviceClient();
  const step = async (stage: string, detail: string, kind = "info") => {
    await db.from("research_job_steps").insert({
      job_id: job.id, user_id: job.user_id, stage, detail, kind, ms: 0,
    });
  };

  try {
    await step("DISCOVER", `worker claimed job ${job.id} (attempt ${job.attempts})`, "ok");
    // The goal drives which provider seeds to fetch. Providers are allowlisted.
    const seeds: string[] = Array.isArray(job.seeds) ? job.seeds : [];
    let fetched = 0;
    for (const url of seeds.slice(0, 10)) {
      try {
        const r = await safeFetch(url);
        fetched++;
        await step("FETCH", `GET ${url} → ${r.status} · ${r.text.length} bytes`, "ok");
        // Store a source snapshot (provenance) scoped to the user.
        await db.from("opportunity_snapshots").upsert({
          user_id: job.user_id,
          opp_id: `raw-${job.id}-${fetched}`,
          data: { url, retrievedAt: r.retrievedAt, chars: r.text.length },
          status: "unverified",
          canonical_url: url,
        }, { onConflict: "user_id,opp_id" });
      } catch (e) {
        // A failed source is recorded as an error, never silently replaced.
        await step("FETCH", `${url}: ${(e as Error).message}`, "error");
      }
    }
    await step("STORE", `${fetched} source snapshot(s) stored with provenance`, fetched ? "ok" : "warn");
    await db.rpc("forge_job_complete", { p_job_id: job.id, p_result: { fetched } });
  } catch (e) {
    await step("ERROR", (e as Error).message, "error");
    await db.rpc("forge_job_fail", { p_job_id: job.id, p_error: (e as Error).message });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const caller = await requireCaller(req);
    const body = await req.json().catch(() => ({}));

    if (body.action === "enqueue") {
      if (caller === "worker") return json({ error: "worker cannot enqueue" }, 403);
      const db = serviceClient();
      const idempotencyKey = String(body.idempotencyKey ?? `${caller}:${body.goal ?? ""}`);
      // Idempotent insert: same (user, key) returns the existing row.
      const { data: existing } = await db.from("research_jobs")
        .select("*").eq("user_id", caller).eq("idempotency_key", idempotencyKey).maybeSingle();
      if (existing) return json({ jobId: existing.id, state: existing.state, reused: true });
      const id = `job-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
      const { error } = await db.from("research_jobs").insert({
        id, user_id: caller, idempotency_key: idempotencyKey,
        goal: String(body.goal ?? ""), mode: "live", state: "queued",
        seeds: Array.isArray(body.seeds) ? body.seeds.slice(0, 10) : [],
      });
      if (error) throw new Error(error.message);
      return json({ jobId: id, state: "queued", reused: false });
    }

    if (body.action === "run") {
      // Drain up to N jobs. Each claim is atomic; concurrent workers split the queue.
      const max = Math.min(Number(body.max ?? 1), 10);
      const processed: string[] = [];
      for (let i = 0; i < max; i++) {
        const job = await claimJob();
        if (!job) break;
        await executeJob(job);
        processed.push(job.id);
      }
      return json({ processed });
    }

    return json({ error: `unknown action ${body.action}` }, 400);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: (e as Error).message }, status);
  }
});
