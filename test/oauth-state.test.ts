import { describe, it, expect } from "vitest";
import { validateState, STATE_TTL_MS, type StateRow } from "../supabase/functions/_shared/oauth-state";

function row(over: Partial<StateRow> = {}): StateRow {
  return {
    state: "s-123",
    user_id: "u-1",
    provider: "github",
    pkce_verifier: null,
    redirect_to: "https://forge.example.com/",
    used: false,
    created_at: new Date(Date.now() - 60_000).toISOString(), // 1 min old
    ...over,
  };
}

describe("OAuth state validation (P2)", () => {
  it("accepts a correct, fresh, unused state", () => {
    const v = validateState("s-123", row(), "github");
    expect(v.ok).toBe(true);
  });

  it("rejects missing state", () => {
    expect(validateState(null, row(), "github")).toEqual({ ok: false, reason: "missing" });
    expect(validateState(undefined, row(), "github")).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects unknown state (not found)", () => {
    expect(validateState("s-123", null, "github")).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects a state for the wrong provider", () => {
    expect(validateState("s-123", row({ provider: "google" }), "github")).toEqual({
      ok: false,
      reason: "wrong_provider",
    });
  });

  it("rejects a replayed (already used) state", () => {
    expect(validateState("s-123", row({ used: true }), "github")).toEqual({ ok: false, reason: "reused" });
  });

  it("rejects an expired state", () => {
    const old = new Date(Date.now() - STATE_TTL_MS - 1000).toISOString();
    expect(validateState("s-123", row({ created_at: old }), "github")).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects an unparseable created_at", () => {
    expect(validateState("s-123", row({ created_at: "not-a-date" }), "github")).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});
