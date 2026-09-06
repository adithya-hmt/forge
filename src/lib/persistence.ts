// ─── Persistence adapters ───────────────────────────────────────────────────
// supabase: real CRUD against RLS-protected tables (user scoped by auth.uid()).
// session:  in-memory only; the UI labels this mode — it never pretends to persist.
//
// P8: every Supabase operation checks `.error` and THROWS a PersistenceError. The
// store surfaces these in the UI. There is no `console.warn`-and-continue path for
// an operation whose failure means user data was not saved.

import type { PostgrestSingleResponse, SupabaseClient } from "@supabase/supabase-js";
import type { Application, FitDim, LearnedAdjustment, Plan, Profile } from "./types";

export class PersistenceError extends Error {
  constructor(public op: string, message: string) {
    super(`[${op}] ${message}`);
    this.name = "PersistenceError";
  }
}

/** Unwrap a PostgREST response or throw. Never returns an unchecked error. */
function unwrap<T>(res: PostgrestSingleResponse<T>, op: string): T {
  if (res.error) throw new PersistenceError(op, res.error.message);
  return res.data as T;
}

export interface PersistedSlice {
  profile: Profile;
  weights: Record<FitDim, number>;
  learned: LearnedAdjustment[];
  applications: Record<string, Application>;
  plans: Record<string, Plan>;
  corrections: { skillId: string; confidence: number }[];
}

export interface JobRow {
  id: string; userId: string; idempotencyKey: string; goal: string; mode: string;
  state: string; attempts: number; maxAttempts: number; lastError: string | null;
  costUsd: number; resultIds: string[];
}
export interface StepRow {
  jobId: string; userId: string; stage: string; kind: string; detail: string; ms: number;
}
export interface SnapshotRow { userId: string; oppId: string; data: unknown; status: string; canonicalUrl: string | null; contentHash: string; epoch: number; }

/** P9 — everything rehydrated on login/reload, in a defined order. */
export interface UserWorkspace extends PersistedSlice {
  snapshots: SnapshotRow[];
  integrations: { provider: string; status: string }[];
  recentJobs: JobRow[];
}

export interface PersistenceAdapter {
  kind: "supabase" | "session";
  load(): Promise<PersistedSlice | null>;
  /** P9: full rehydration including snapshots, integrations, recent jobs. */
  loadUserWorkspace(): Promise<UserWorkspace | null>;
  save(slice: PersistedSlice): Promise<void>;
  saveJob(row: JobRow): Promise<void>;
  saveStep(row: StepRow): Promise<void>;
  saveSnapshots(rows: SnapshotRow[]): Promise<void>;
}

// ─── Session adapter (explicitly non-persistent) ────────────────────────────

export function sessionAdapter(): PersistenceAdapter {
  return {
    kind: "session",
    async load() { return null; },
    async loadUserWorkspace() { return null; },
    async save() { /* by design: nothing outlives the tab */ },
    async saveJob() { /* jobs observable in-app only */ },
    async saveStep() { /* steps observable in-app only */ },
    async saveSnapshots() { /* in-memory store only */ },
  };
}

// ─── Supabase adapter ───────────────────────────────────────────────────────

export function supabaseAdapter(client: SupabaseClient, userId: string): PersistenceAdapter {
  return {
    kind: "supabase",

    async load() {
      const ws = await this.loadUserWorkspace();
      if (!ws) return null;
      const { snapshots: _s, integrations: _i, recentJobs: _j, ...slice } = ws;
      return slice;
    },

    async loadUserWorkspace() {
      // Hydration order (P9): profile first (identity), then preference model, then
      // execution data, then research history. A missing profile ⇒ nothing to load.
      const profRes = await client.from("profiles").select("*").eq("user_id", userId).maybeSingle();
      const prof = unwrap(profRes, "load:profiles");
      if (!prof) return null;

      const learned = unwrap(await client.from("learned_adjustments").select("*").eq("user_id", userId), "load:learned");
      const apps = unwrap(await client.from("applications").select("*").eq("user_id", userId), "load:applications");
      const plans = unwrap(await client.from("execution_plans").select("*").eq("user_id", userId), "load:plans");
      const corr = unwrap(await client.from("evidence_corrections").select("*").eq("user_id", userId), "load:corrections");
      const snaps = unwrap(await client.from("opportunity_snapshots").select("*").eq("user_id", userId), "load:snapshots");
      const integ = unwrap(await client.from("integrations").select("provider,status").eq("user_id", userId), "load:integrations");
      const jobs = unwrap(
        await client.from("research_jobs").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
        "load:jobs",
      );

      const applications: Record<string, Application> = {};
      for (const a of apps ?? []) applications[a.opp_id] = { oppId: a.opp_id, status: a.status, updatedAt: Date.parse(a.updated_at), drafts: a.drafts };
      const planMap: Record<string, Plan> = {};
      for (const pl of plans ?? []) planMap[pl.opp_id] = { ...(pl.plan as Plan), oppId: pl.opp_id, calendarSynced: pl.calendar_synced, deadline: pl.deadline ? Date.parse(pl.deadline) : null };

      return {
        profile: {
          name: prof.name, level: prof.level, location: prof.location, remoteOnly: prof.remote_only,
          hoursPerWeek: prof.hours_per_week, categories: prof.categories, windowDays: prof.window_days,
        },
        weights: prof.weights,
        learned: (learned ?? []).map((l) => ({ key: l.key, label: l.label, delta: l.delta, reason: l.reason })),
        applications,
        plans: planMap,
        corrections: (corr ?? []).map((c) => ({ skillId: c.skill_id, confidence: Number(c.confidence) })),
        snapshots: (snaps ?? []).map((s) => ({
          userId: s.user_id, oppId: s.opp_id, data: s.data, status: s.status,
          canonicalUrl: s.canonical_url, contentHash: s.content_hash, epoch: s.first_seen_epoch,
        })),
        integrations: (integ ?? []).map((i) => ({ provider: i.provider, status: i.status })),
        recentJobs: (jobs ?? []).map((j) => ({
          id: j.id, userId: j.user_id, idempotencyKey: j.idempotency_key, goal: j.goal, mode: j.mode,
          state: j.state, attempts: j.attempts, maxAttempts: j.max_attempts, lastError: j.last_error,
          costUsd: Number(j.cost_usd), resultIds: j.result_ids,
        })),
      };
    },

    async save(slice) {
      const { profile: pr, weights, learned, applications, plans, corrections } = slice;
      unwrap(
        await client.from("profiles").upsert({
          user_id: userId, name: pr.name, level: pr.level, location: pr.location,
          remote_only: pr.remoteOnly, hours_per_week: pr.hoursPerWeek, window_days: pr.windowDays,
          categories: pr.categories, weights,
        }, { onConflict: "user_id" }).select(),
        "save:profiles",
      );

      unwrap(await client.from("learned_adjustments").delete().eq("user_id", userId), "save:learned:delete");
      if (learned.length)
        unwrap(
          await client.from("learned_adjustments").insert(learned.map((l) => ({ user_id: userId, key: l.key, label: l.label, delta: l.delta, reason: l.reason }))),
          "save:learned:insert",
        );

      for (const a of Object.values(applications))
        unwrap(
          await client.from("applications").upsert({ user_id: userId, opp_id: a.oppId, status: a.status, drafts: a.drafts }, { onConflict: "user_id,opp_id" }),
          `save:applications:${a.oppId}`,
        );

      for (const pl of Object.values(plans))
        unwrap(
          await client.from("execution_plans").upsert({
            user_id: userId, opp_id: pl.oppId, deadline: pl.deadline ? new Date(pl.deadline).toISOString() : null,
            plan: { milestones: pl.milestones, tasks: pl.tasks, docs: pl.docs, contacts: pl.contacts, checklist: pl.checklist, calendar: pl.calendar, createdAt: pl.createdAt },
            calendar_synced: pl.calendarSynced,
          }, { onConflict: "user_id,opp_id" }),
          `save:plans:${pl.oppId}`,
        );

      unwrap(await client.from("evidence_corrections").delete().eq("user_id", userId), "save:corrections:delete");
      if (corrections.length)
        unwrap(
          await client.from("evidence_corrections").insert(corrections.map((c) => ({ user_id: userId, skill_id: c.skillId, confidence: c.confidence }))),
          "save:corrections:insert",
        );
    },

    async saveJob(row) {
      unwrap(
        await client.from("research_jobs").upsert({
          id: row.id, user_id: row.userId, idempotency_key: row.idempotencyKey, goal: row.goal,
          mode: row.mode, state: row.state, attempts: row.attempts, max_attempts: row.maxAttempts,
          last_error: row.lastError, cost_usd: row.costUsd, result_ids: row.resultIds,
        }, { onConflict: "id" }),
        "saveJob",
      );
    },

    async saveStep(row) {
      unwrap(
        await client.from("research_job_steps").insert({
          job_id: row.jobId, user_id: row.userId, stage: row.stage, kind: row.kind, detail: row.detail, ms: row.ms,
        }),
        "saveStep",
      );
    },

    async saveSnapshots(rows) {
      if (!rows.length) return;
      unwrap(
        await client.from("opportunity_snapshots").upsert(
          rows.map((r) => ({
            user_id: r.userId, opp_id: r.oppId, data: r.data, status: r.status,
            canonical_url: r.canonicalUrl, content_hash: r.contentHash, first_seen_epoch: r.epoch,
          })),
          { onConflict: "user_id,opp_id" },
        ),
        "saveSnapshots",
      );
    },
  };
}
