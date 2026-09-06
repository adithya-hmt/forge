// P2 — Server-side OAuth state validation, isolated as pure logic so it can be
// unit-tested without a database. A `StateRow` is whatever the oauth_states table
// returns; the caller is responsible for the atomic "mark used" UPDATE.
//
// Rules enforced here:
//   - state must exist
//   - state must belong to the expected provider
//   - state must not already be used (replay protection)
//   - state must not be expired (default 10 minutes)
export interface StateRow {
  state: string;
  user_id: string | null;
  provider: string;
  pkce_verifier: string | null;
  redirect_to: string;
  used: boolean;
  created_at: string;
}

export type StateVerdict =
  | { ok: true; row: StateRow }
  | { ok: false; reason: "missing" | "not_found" | "wrong_provider" | "reused" | "expired" };

export const STATE_TTL_MS = 10 * 60 * 1000;

export function validateState(
  presented: string | null | undefined,
  row: StateRow | null | undefined,
  expectedProvider: string,
  now: number = Date.now(),
): StateVerdict {
  if (!presented) return { ok: false, reason: "missing" };
  if (!row) return { ok: false, reason: "not_found" };
  if (row.provider !== expectedProvider) return { ok: false, reason: "wrong_provider" };
  if (row.used) return { ok: false, reason: "reused" };
  const age = now - Date.parse(row.created_at);
  if (Number.isNaN(age) || age > STATE_TTL_MS) return { ok: false, reason: "expired" };
  return { ok: true, row };
}
