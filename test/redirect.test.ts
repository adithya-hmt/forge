import { describe, it, expect } from "vitest";
import { isAllowedRedirect, trustedOrigins } from "../supabase/functions/_shared/redirect";

const APP = "https://forge.example.com";

describe("redirect allowlist (P3)", () => {
  it("accepts the configured app origin", () => {
    const r = isAllowedRedirect("https://forge.example.com/settings", APP);
    expect(r.ok).toBe(true);
    expect(r.url).toBe("https://forge.example.com/settings");
  });

  it("falls back to app origin when candidate is missing", () => {
    expect(isAllowedRedirect(null, APP).url).toBe("https://forge.example.com/");
    expect(isAllowedRedirect("", APP).url).toBe("https://forge.example.com/");
  });

  it("rejects a different hostname", () => {
    expect(isAllowedRedirect("https://evil.com/steal", APP).ok).toBe(false);
  });

  it("rejects an unexpected protocol", () => {
    expect(isAllowedRedirect("javascript:alert(1)", APP).ok).toBe(false);
    expect(isAllowedRedirect("file:///etc/passwd", APP).ok).toBe(false);
  });

  it("rejects embedded credentials", () => {
    expect(isAllowedRedirect("https://user:pass@forge.example.com/", APP).ok).toBe(false);
  });

  it("rejects protocol-relative URLs", () => {
    expect(isAllowedRedirect("//evil.com", APP).ok).toBe(false);
  });

  it("rejects backslash / control-char tricks", () => {
    expect(isAllowedRedirect("https://forge.example.com\\@evil.com", APP).ok).toBe(false);
    expect(isAllowedRedirect("https://forge.example.com/%0d%0a", APP).ok).toBe(true); // path is fine
    expect(isAllowedRedirect("https://forge.example.com/\u0000", APP).ok).toBe(false);
  });

  it("rejects localhost in production unless allowlisted", () => {
    expect(isAllowedRedirect("http://localhost:3000/cb", APP).ok).toBe(false);
    const r = isAllowedRedirect("http://localhost:3000/cb", APP, "http://localhost:3000");
    expect(r.ok).toBe(true);
  });

  it("honours an extra-origins allowlist", () => {
    const r = isAllowedRedirect("https://staging.forge.example.com/x", APP, "https://staging.forge.example.com");
    expect(r.ok).toBe(true);
  });

  it("drops the hash and never reflects attacker fragments", () => {
    const r = isAllowedRedirect("https://forge.example.com/cb?a=1#evil", APP);
    expect(r.ok).toBe(true);
    expect(r.url).not.toContain("#");
  });

  it("trustedOrigins normalizes and dedupes", () => {
    expect(trustedOrigins("https://a.com/", "https://a.com,https://b.com,not-a-url")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });
});
