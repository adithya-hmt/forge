import { describe, it, expect } from "vitest";
import { validateFetchUrl, isBlockedHost } from "../supabase/functions/_shared/ssrf";

describe("SSRF guard (P11)", () => {
  it("allows a known provider host", () => {
    const r = validateFetchUrl("https://remoteok.com/api/jobs");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.provider).toBe("remoteok");
  });

  it("allows provider subdomains", () => {
    expect(validateFetchUrl("https://api.devpost.com/hackathons").ok).toBe(true);
    expect(validateFetchUrl("https://hn.algolia.com/api/v1/search").ok).toBe(true);
  });

  it("rejects an unlisted host", () => {
    expect(validateFetchUrl("https://attacker-controlled.com/x")).toEqual({
      ok: false,
      reason: "not_allowlisted",
    });
  });

  it("rejects non-http schemes", () => {
    expect(validateFetchUrl("file:///etc/passwd").ok).toBe(false);
    expect(validateFetchUrl("gopher://remoteok.com/").ok).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(validateFetchUrl("not a url")).toEqual({ ok: false, reason: "bad_url" });
  });

  it("blocks localhost and loopback", () => {
    expect(isBlockedHost("localhost")).toBe(true);
    expect(isBlockedHost("127.0.0.1")).toBe(true);
    expect(isBlockedHost("::1")).toBe(true);
  });

  it("blocks private RFC1918 / link-local / CGNAT ranges", () => {
    expect(isBlockedHost("10.0.0.5")).toBe(true);
    expect(isBlockedHost("192.168.1.1")).toBe(true);
    expect(isBlockedHost("172.16.0.1")).toBe(true);
    expect(isBlockedHost("169.254.169.254")).toBe(true); // cloud metadata
    expect(isBlockedHost("100.64.0.1")).toBe(true);
  });

  it("normalizes the URL, dropping userinfo/fragment", () => {
    const r = validateFetchUrl("https://user:pw@remoteok.com/api?x=1#frag");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized).not.toContain("user:pw");
      expect(r.normalized).not.toContain("#frag");
      expect(r.normalized).toContain("x=1");
    }
  });

  it("does not allow allowlist bypass via suffix trickery", () => {
    // "evlremoteok.com" must NOT match "remoteok.com"
    expect(validateFetchUrl("https://evilremoteok.com/").ok).toBe(false);
  });
});
