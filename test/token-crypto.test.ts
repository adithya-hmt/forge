import { describe, it, expect } from "vitest";
import { encryptToken, decryptToken, CRYPTO_VERSION } from "../supabase/functions/_shared/token-crypto";

const KEY = "test-oauth-encryption-key-0123456789abcdef";

describe("token encryption (P4/P5)", () => {
  it("round-trips ASCII", async () => {
    const s = await encryptToken("gho_abc123", KEY);
    expect(s.alg).toBe("A256GCM");
    expect(s.v).toBe(CRYPTO_VERSION);
    expect(await decryptToken(s, KEY)).toBe("gho_abc123");
  });

  it("round-trips Unicode", async () => {
    const plain = "токен-✓-秘密-🔑";
    const s = await encryptToken(plain, KEY);
    expect(await decryptToken(s, KEY)).toBe(plain);
  });

  it("round-trips a long refresh token", async () => {
    const plain = "1//0g" + "x".repeat(2048);
    const s = await encryptToken(plain, KEY);
    expect(await decryptToken(s, KEY)).toBe(plain);
  });

  it("produces a database-safe base64 string (no raw bytes)", async () => {
    const s = await encryptToken("secret", KEY);
    expect(typeof s.data).toBe("string");
    expect(s.data).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("two encryptions of the same plaintext differ (random nonce)", async () => {
    const a = await encryptToken("same", KEY);
    const b = await encryptToken("same", KEY);
    expect(a.data).not.toBe(b.data);
    expect(await decryptToken(a, KEY)).toBe("same");
    expect(await decryptToken(b, KEY)).toBe("same");
  });

  it("rejects a wrong key", async () => {
    const s = await encryptToken("secret", KEY);
    await expect(decryptToken(s, "a-different-key")).rejects.toThrow(/decryption failed/);
  });

  it("rejects corrupted ciphertext", async () => {
    const s = await encryptToken("secret", KEY);
    const corrupted = { ...s, data: s.data.slice(0, -4) + (s.data.endsWith("AAAA") ? "BBBB" : "AAAA") };
    await expect(decryptToken(corrupted, KEY)).rejects.toThrow();
  });

  it("rejects corrupted nonce (bit flip)", async () => {
    const s = await encryptToken("secret", KEY);
    const bytes = Uint8Array.from(atob(s.data), (c) => c.charCodeAt(0));
    bytes[3] ^= 0xff; // flip a nonce byte
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    await expect(decryptToken({ ...s, data: btoa(bin) }, KEY)).rejects.toThrow(/decryption failed/);
  });

  it("rejects truncated ciphertext", async () => {
    await expect(decryptToken({ data: "AQID", alg: "A256GCM", v: 1 }, KEY)).rejects.toThrow(/truncated/);
  });

  it("rejects invalid base64", async () => {
    await expect(decryptToken({ data: "!!!not-base64!!!", alg: "A256GCM", v: 1 }, KEY)).rejects.toThrow(/base64/);
  });

  it("rejects unsupported version", async () => {
    const s = await encryptToken("secret", KEY);
    const bytes = Uint8Array.from(atob(s.data), (c) => c.charCodeAt(0));
    bytes[0] = 99;
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    await expect(decryptToken({ ...s, data: btoa(bin) }, KEY)).rejects.toThrow(/version/);
  });

  it("rejects missing key", async () => {
    await expect(encryptToken("x", "")).rejects.toThrow(/not configured/);
  });
});
