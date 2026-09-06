import { describe, it, expect } from "vitest";
import { buildMime, sanitizeHeaderValue, isValidAddress, encodeSubject, mimeToRaw } from "../supabase/functions/_shared/mime";

describe("MIME builder (P16)", () => {
  it("builds a well-formed message with CRLF line endings", () => {
    const mime = buildMime({ to: "a@b.com", subject: "Hello", body: "line1\nline2" });
    expect(mime).toContain("To: a@b.com\r\n");
    expect(mime).toContain("Subject: Hello\r\n");
    expect(mime).toContain("MIME-Version: 1.0\r\n");
    expect(mime.endsWith("line1\r\nline2")).toBe(true);
  });

  it("neutralizes CRLF header injection in the subject", () => {
    const evil = "Hi\r\nBcc: attacker@evil.com";
    const sanitized = sanitizeHeaderValue(evil);
    expect(sanitized).not.toContain("\r");
    expect(sanitized).not.toContain("\n");
    const mime = buildMime({ to: "a@b.com", subject: evil, body: "x" });
    // No injected Bcc header may appear
    expect(mime.toLowerCase()).not.toContain("bcc: attacker@evil.com");
    // Exactly one blank line separates headers from body
    expect(mime.split("\r\n\r\n").length).toBe(2);
  });

  it("neutralizes newline injection in the recipient", () => {
    expect(isValidAddress("a@b.com\r\nBcc: x@y.com")).toBe(false);
  });

  it("rejects invalid recipients", () => {
    expect(isValidAddress("")).toBe(false);
    expect(isValidAddress("no-at-sign")).toBe(false);
    expect(isValidAddress("two@@ats.com")).toBe(false);
    expect(isValidAddress("a b@c.com")).toBe(false);
    expect(() => buildMime({ to: "not-an-email", subject: "s", body: "b" })).toThrow(/invalid recipient/);
  });

  it("RFC2047-encodes non-ASCII subjects", () => {
    const enc = encodeSubject("Héllo — 世界");
    expect(enc).toMatch(/^=\?UTF-8\?B\?.*\?=$/);
  });

  it("keeps ASCII subjects readable", () => {
    expect(encodeSubject("Plain ASCII")).toBe("Plain ASCII");
  });

  it("folds long body lines to <=76 chars", () => {
    const long = "x".repeat(200);
    const mime = buildMime({ to: "a@b.com", subject: "s", body: long });
    const body = mime.split("\r\n\r\n")[1];
    for (const line of body.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
  });

  it("produces base64url raw without padding or +/", () => {
    const raw = mimeToRaw("Subject: test\r\n\r\nbody 😀");
    expect(raw).not.toMatch(/[+/=]/);
    expect(raw.length).toBeGreaterThan(0);
  });
});
