// ─── Persistence adapters ───────────────────────────────────────────────────
// supabase: real CRUD against RLS-protected tables (user scoped by auth.uid()).
// session:  in-memory only; the UI labels this mode — it never pretends to persist.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Application, FitDim, LearnedAdjustment, Plan, Profile } from "./types";

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

export interface PersistenceAdapter {
  kind: "supabase" | "session";
  load(): Promise<PersistedSlice | null>;
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
    async save() { /* by design: nothing outlives the tab */ },
    async saveJob() { /* jobs observable in-app only */ },
    async saveStep() { /* steps observable in-app only */ },
    async saveSnapshots() { /* in-memory store only */ },
  };
}

// ─── Supabase adapter ───────────────────────────────────────────────────────

export function supabaseAdapter(client: SupabaseClient, userId: string): PersistenceAdapter {
  const fail = (op: string, err: { message: string } | null) => {
    if (err) console.warn(`[forge/persistence] ${op}: ${err.message}`);
  };

  return {
    kind: "supabase",

    async load() {
      const [prof, learned, apps, plans, corr] = await Promise.all([
        client.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
        client.from("learned_adjustments").select("*").eq("user_id", userId),
        client.from("applications").select("*").eq("user_id", userId),
        client.from("execution_plans").select("*").eq("user_id", userId),
        client.from("evidence_corrections").select("*").eq("user_id", userId),
      ]);
      if (!prof.data) return null;
      const p = prof.data;
      const applications: Record<string, Application> = {};
      for (const a of apps.data ?? []) applications[a.opp_id] = { oppId: a.opp_id, status: a.status, updatedAt: Date.parse(a.updated_at), drafts: a.drafts };
      const planMap: Record<string, Plan> = {};
      for (const pl of plans.data ?? []) planMap[pl.opp_id] = { ...(pl.plan as Plan), oppId: pl.opp_id, calendarSynced: pl.calendar_synced, deadline: pl.deadline ? Date.parse(pl.deadline) : null };
      return {
        profile: {
          name: p.name, level: p.level, location: p.location, remoteOnly: p.remote_only,
          hoursPerWeek: p.hours_per_week, categories: p.categories, windowDays: p.window_days,
        },
        weights: p.weights,
        learned: (learned.data ?? []).map((l) => ({ key: l.key, label: l.label, delta: l.delta, reason: l.reason })),
        applications, plans: planMap,
        corrections: (corr.data ?? []).map((c) => ({ skillId: c.skill_id, confidence: Number(c.confidence) })),
      };
    },

    async save(slice) {
      const { profile: pr, weights, learned, applications, plans, corrections } = slice;
      const [, e1] = await Promise.all([
        client.from("profiles").upsert({
          user_id: userId, name: pr.name, level: pr.level, location: pr.location,
          remote_only: pr.remoteOnly, hours_per_week: pr.hoursPerWeek, window_days: pr.windowDays,
          categories: pr.categories, weights,
        }, { onConflict: "user_id" }).select(),
        Promise.resolve(null),
      ]);
      fail("profiles", e1 as never);

      await client.from("learned_adjustments").delete().eq("user_id", userId);
      if (learned.length)
        await client.from("learned_adjustments").insert(learned.map((l) => ({ user_id: userId, key: l.key, label: l.label, delta: l.delta, reason: l.reason })));

      for (const a of Object.values(applications))
        await client.from("applications").upsert({ user_id: userId, opp_id: a.oppId, status: a.status, drafts: a.drafts }, { onConflict: "user_id,opp_id" });

      for (const pl of Object.values(plans))
        await client.from("execution_plans").upsert({
          user_id: userId, opp_id: pl.oppId, deadline: pl.deadline ? new Date(pl.deadline).toISOString() : null,
          plan: { milestones: pl.milestones, tasks: pl.tasks, docs: pl.docs, contacts: pl.contacts, checklist: pl.checklist, calendar: pl.calendar, createdAt: pl.createdAt },
          calendar_synced: pl.calendarSynced,
        }, { onConflict: "user_id,opp_id" });

      await client.from("evidence_corrections").delete().eq("user_id", userId);
      if (corrections.length)
        await client.from("evidence_corrections").insert(corrections.map((c) => ({ user_id: userId, skill_id: c.skillId, confidence: c.confidence })));
    },

    async saveJob(row) {
      const { error } = await client.from("research_jobs").upsert({
        id: row.id, user_id: row.userId, idempotency_key: row.idempotencyKey, goal: row.goal,
        mode: row.mode, state: row.state, attempts: row.attempts, max_attempts: row.maxAttempts,
        last_error: row.lastError, cost_usd: row.costUsd, result_ids: row.resultIds,
      }, { onConflict: "id" });
      fail("research_jobs", error);
    },

    async saveStep(row) {
      const { error } = await client.from("research_job_steps").insert({
        job_id: row.jobId, user_id: row.userId, stage: row.stage, kind: row.kind, detail: row.detail, ms: row.ms,
      });
      fail("research_job_steps", error);
    },

    async saveSnapshots(rows) {
      if (!rows.length) return;
      const { error } = await client.from("opportunity_snapshots").upsert(
        rows.map((r) => ({
          user_id: r.userId, opp_id: r.oppId, data: r.data, status: r.status,
          canonical_url: r.canonicalUrl, content_hash: r.contentHash, first_seen_epoch: r.epoch,
        })),
        { onConflict: "user_id,opp_id" },
      );
      fail("opportunity_snapshots", error);
    },
  };
}
