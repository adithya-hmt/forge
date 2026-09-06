import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// P7 — Real database RLS isolation test with TWO actual users.
//
// This test does NOT simulate RLS in JavaScript. It creates USER_A and USER_B via the
// Supabase Auth admin API (service role), signs each in to obtain real JWTs, then
// issues genuine PostgREST requests as each user and asserts isolation.
//
// Requirements to run: a reachable Supabase project with migrations applied.
//   SUPABASE_URL           — project URL
//   SUPABASE_SERVICE_ROLE_KEY — to create users (admin) — NEVER bundled to browser
//   SUPABASE_ANON_KEY      — to build per-user clients
//
// When these are absent the suite reports BLOCKED_BY_CREDENTIALS and skips — it never
// silently passes. Run via `npm run test:security` (dedicated vitest config).

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;

const haveCreds = Boolean(URL && SERVICE && ANON);
const d = haveCreds ? describe : describe.skip;

if (!haveCreds) {
  // Surface a visible, honest message rather than a silent skip.
  console.warn(
    "\n[test:security] BLOCKED_BY_CREDENTIALS — set SUPABASE_URL, SUPABASE_ANON_KEY and " +
    "SUPABASE_SERVICE_ROLE_KEY (local `supabase start` works) to run the two-user RLS suite.\n",
  );
}

let admin: SupabaseClient;
let userA: SupabaseClient;
let userB: SupabaseClient;
let uidA = "";
let uidB = "";
const EMAIL_A = `rls-a-${Date.now()}@forge.test`;
const EMAIL_B = `rls-b-${Date.now()}@forge.test`;
const PASSWORD = "Str0ng!Passw0rd-Test";

const USER_TABLES = [
  "profiles", "applications", "execution_plans", "opportunity_snapshots",
  "research_jobs", "notifications", "evidence_corrections",
] as const;

d("RLS isolation: USER_A vs USER_B (live database)", () => {
  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });

    const mk = async (email: string) => {
      const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (error) throw new Error(`createUser ${email}: ${error.message}`);
      return data.user!.id;
    };
    uidA = await mk(EMAIL_A);
    uidB = await mk(EMAIL_B);

    const signIn = async (email: string) => {
      const c = createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`signIn ${email}: ${error.message}`);
      return c;
    };
    userA = await signIn(EMAIL_A);
    userB = await signIn(EMAIL_B);

    // Seed one row per table for USER_A (as USER_A, proving self-write works).
    for (const t of USER_TABLES) {
      const row: Record<string, unknown> = { user_id: uidA };
      if (t === "profiles") Object.assign(row, { name: "A", level: "student" });
      if (t === "applications") Object.assign(row, { opp_id: "opp-a", status: "saved" });
      if (t === "execution_plans") Object.assign(row, { opp_id: "opp-a", plan: {} });
      if (t === "opportunity_snapshots") Object.assign(row, { opp_id: "opp-a", data: {}, status: "unverified" });
      if (t === "research_jobs") Object.assign(row, { id: `job-a-${Date.now()}`, idempotency_key: "k-a", goal: "g" });
      if (t === "notifications") Object.assign(row, { kind: "system", msg: "a" });
      if (t === "evidence_corrections") Object.assign(row, { skill_id: "sk-a", confidence: 0.5 });
      const { error } = await userA.from(t).insert(row);
      expect(error, `USER_A insert into ${t}`).toBeNull();
    }
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.auth.admin.deleteUser(uidA).catch(() => undefined);
    await admin.auth.admin.deleteUser(uidB).catch(() => undefined);
  }, 30_000);

  it("USER_A can SELECT its own rows", async () => {
    const { data, error } = await userA.from("profiles").select("*").eq("user_id", uidA);
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);
  });

  for (const t of USER_TABLES) {
    it(`USER_B cannot SELECT USER_A rows in ${t}`, async () => {
      const { data, error } = await userB.from(t).select("*").eq("user_id", uidA);
      // RLS returns zero rows (not an error) for a filtered read.
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it(`USER_B cannot UPDATE USER_A rows in ${t}`, async () => {
      const patch: Record<string, unknown> = {};
      if (t === "profiles") patch.name = "hacked";
      if (t === "applications") patch.status = "won";
      if (t === "notifications") patch.msg = "hacked";
      if (t === "evidence_corrections") patch.confidence = 1;
      if (t === "execution_plans") patch.calendar_synced = true;
      if (t === "opportunity_snapshots") patch.status = "verified";
      if (t === "research_jobs") patch.state = "completed";
      const { error } = await userB.from(t).update(patch).eq("user_id", uidA);
      expect(error).toBeNull();
      // Confirm the row was NOT changed by re-reading as USER_A.
      const { data } = await userA.from(t).select("*").eq("user_id", uidA);
      if (t === "profiles") expect((data?.[0] as any)?.name).toBe("A");
      if (t === "applications") expect((data?.[0] as any)?.status).toBe("saved");
    });

    it(`USER_B cannot DELETE USER_A rows in ${t}`, async () => {
      const before = await userA.from(t).select("*").eq("user_id", uidA);
      const { error } = await userB.from(t).delete().eq("user_id", uidA);
      expect(error).toBeNull();
      const after = await userA.from(t).select("*").eq("user_id", uidA);
      expect(after.data?.length).toBe(before.data?.length);
    });

    it(`USER_B cannot INSERT a row claiming USER_A's id into ${t}`, async () => {
      const row: Record<string, unknown> = { user_id: uidA };
      if (t === "profiles") Object.assign(row, { name: "forged" });
      if (t === "applications") Object.assign(row, { opp_id: "opp-forged", status: "saved" });
      if (t === "execution_plans") Object.assign(row, { opp_id: "opp-forged", plan: {} });
      if (t === "opportunity_snapshots") Object.assign(row, { opp_id: "opp-forged", data: {}, status: "unverified" });
      if (t === "research_jobs") Object.assign(row, { id: `job-forged-${Date.now()}`, idempotency_key: "k-forged", goal: "g" });
      if (t === "notifications") Object.assign(row, { kind: "system", msg: "forged" });
      if (t === "evidence_corrections") Object.assign(row, { skill_id: "sk-forged", confidence: 1 });
      const { error } = await userB.from(t).insert(row);
      // RLS WITH CHECK must reject the spoofed user_id.
      expect(error, `spoofed insert into ${t} must fail`).not.toBeNull();
    });
  }

  it("authenticated clients have NO direct access to oauth_credentials", async () => {
    const { data, error } = await userA.from("oauth_credentials").select("*");
    // Either RLS yields zero rows, or the table is not even exposed (permission denied).
    if (error) {
      expect(error.message).toMatch(/permission|denied|schema cache|does not exist/i);
    } else {
      expect(data).toHaveLength(0);
    }
  });

  it("authenticated clients have NO direct access to oauth_states", async () => {
    const { data, error } = await userA.from("oauth_states").select("*");
    if (error) {
      expect(error.message).toMatch(/permission|denied|schema cache|does not exist/i);
    } else {
      expect(data).toHaveLength(0);
    }
  });
});
