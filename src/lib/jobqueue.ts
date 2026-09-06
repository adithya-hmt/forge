// ─── Forge job queue ────────────────────────────────────────────────────────
// Genuine async job semantics: IDs, states, attempt counts, leases with expiry,
// exponential-backoff retry policy, idempotency keys, persisted errors.
//
// Concurrency model: single-writer lease. `run()` receives a lease token; before
// committing results the worker must still own the lease. Enqueueing an already
// known idempotency key returns the existing job instead of double-running.
// Persistence: jobs mirror into research_jobs / research_job_steps when a
// Supabase persistence adapter is attached (see persistence.ts).

export type JobState = "queued" | "leased" | "done" | "failed";

export interface Job<T = unknown> {
  id: string;
  idempotencyKey: string;
  state: JobState;
  attempts: number;
  maxAttempts: number;
  leaseToken: string | null;
  leaseExpiresAt: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  result: T | null;
}

export type JobPersistence = (job: Job, event: "created" | "state" | "error" | "result") => void;

export class DuplicateJobError extends Error { constructor(public existing: Job) { super("job already processed"); } }

export class JobQueue {
  private jobs = new Map<string, Job>();
  private byKey = new Map<string, Job>();
  private persist: JobPersistence | null = null;
  private onState: ((job: Job) => void) | null = null;
  now: () => number = () => Date.now();

  setPersistence(p: JobPersistence | null) { this.persist = p; }
  onJobState(cb: (job: Job) => void) { this.onState = cb; }

  get(id: string) { return this.jobs.get(id); }
  byIdempotencyKey(key: string) { return this.byKey.get(key); }
  list() { return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt); }

  private touch(job: Job, event: "created" | "state" | "error" | "result") {
    job.updatedAt = this.now();
    this.persist?.(job, event);
    this.onState?.(job);
  }

  /**
   * Enqueue + run. Idempotent: a second call with the same key while the first
   * is queued/leased resolves to the SAME job and does not re-execute `run`.
   * A previously DONE job with the same key returns its stored result.
   */
  async enqueue<T>(idempotencyKey: string, run: (job: Job) => Promise<T>, maxAttempts = 3): Promise<{ job: Job<T>; result: T; reused: boolean }> {
    const existing = this.byKey.get(idempotencyKey);
    if (existing) {
      if (existing.state === "done") return { job: existing as Job<T>, result: existing.result as T, reused: true };
      if (existing.state === "leased" || existing.state === "queued") {
        // Wait for the in-flight owner instead of double-running.
        return new Promise((resolve, reject) => {
          const iv = setInterval(() => {
            const j = this.byKey.get(idempotencyKey);
            if (!j) { clearInterval(iv); reject(new Error("job vanished")); return; }
            if (j.state === "done") { clearInterval(iv); resolve({ job: j as Job<T>, result: j.result as T, reused: true }); }
            if (j.state === "failed" && j.attempts >= j.maxAttempts) { clearInterval(iv); reject(new Error(j.lastError ?? "job failed")); }
          }, 60);
        });
      }
      // failed with attempts left → fall through and retry below
    }

    const id = `job-${this.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const job: Job<T> = {
      id, idempotencyKey, state: "queued", attempts: 0, maxAttempts,
      leaseToken: null, leaseExpiresAt: 0, lastError: null,
      createdAt: this.now(), updatedAt: this.now(), result: null,
    };
    this.jobs.set(id, job);
    this.byKey.set(idempotencyKey, job);
    this.touch(job, "created");

    let delay = 400;
    for (;;) {
      // Acquire lease
      const leaseToken = Math.random().toString(36).slice(2) + this.now().toString(36);
      job.leaseToken = leaseToken;
      job.leaseExpiresAt = this.now() + 120_000;
      job.state = "leased";
      job.attempts += 1;
      this.touch(job, "state");

      try {
        const result = await run(job);
        // Commit guard: still own an unexpired lease?
        if (job.leaseToken !== leaseToken || job.leaseExpiresAt < this.now()) {
          throw new Error("lease lost before commit — result discarded (idempotency preserved)");
        }
        job.result = result;
        job.state = "done";
        job.leaseToken = null;
        this.touch(job, "result");
        return { job, result, reused: false };
      } catch (e) {
        job.lastError = (e as Error).message;
        this.touch(job, "error");
        if (job.attempts >= job.maxAttempts) {
          job.state = "failed";
          job.leaseToken = null;
          this.touch(job, "state");
          throw e;
        }
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 3200);
      }
    }
  }
}

export const globalQueue = new JobQueue();
