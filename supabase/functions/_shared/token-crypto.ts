// P4 + P5 — Authenticated encryption for OAuth tokens.
//
// Architecture decision (P4): the encryption key is an EDGE FUNCTION secret
// (`OAUTH_ENCRYPTION_KEY`). Encryption happens inside the function with Web Crypto
// AES-256-GCM. The key is NEVER in the frontend, the SQL client, the authenticated
// role, or the browser bundle. (Supabase Vault was rejected because the prior code
// read Vault while docs said "function secret" — two different stores. One store now.)
//
// Serialization decision (P5): PostgreSQL `bytea` RPC values do not reliably
// round-trip as `number[]` through PostgREST. We therefore store a single base64
// `text` blob that packs  version || nonce || ciphertext||tag . The DB column is
// `text`, which serializes identically everywhere.
//
// Wire format (base64 of):  [1 byte version][12 byte nonce][N byte ciphertext+GCM tag]
export const CRYPTO_VERSION = 1;
const NONCE_BYTES = 12;

export interface StoredSecret {
  /** base64( version || nonce || ciphertext+tag ) — safe to store in a text column */
  data: string;
  /** algorithm identifier, stored alongside so a future rotation is explicit */
  alg: "A256GCM";
  v: number;
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Derive a 256-bit CryptoKey from the raw secret string via SHA-256. */
async function deriveKey(rawKey: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(rawKey));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptToken(
  plaintext: string,
  rawKey: string,
): Promise<StoredSecret> {
  if (!rawKey) throw new Error("OAUTH_ENCRYPTION_KEY is not configured");
  const key = await deriveKey(rawKey);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const packed = new Uint8Array(1 + NONCE_BYTES + ct.length);
  packed[0] = CRYPTO_VERSION;
  packed.set(nonce, 1);
  packed.set(ct, 1 + NONCE_BYTES);
  return { data: toB64(packed), alg: "A256GCM", v: CRYPTO_VERSION };
}

export async function decryptToken(
  stored: StoredSecret | string,
  rawKey: string,
): Promise<string> {
  if (!rawKey) throw new Error("OAUTH_ENCRYPTION_KEY is not configured");
  const obj: StoredSecret =
    typeof stored === "string" ? { data: stored, alg: "A256GCM", v: CRYPTO_VERSION } : stored;
  if (obj.alg !== "A256GCM") throw new Error(`unsupported algorithm: ${obj.alg}`);

  let packed: Uint8Array;
  try {
    packed = fromB64(obj.data);
  } catch {
    throw new Error("ciphertext is not valid base64");
  }
  if (packed.length < 1 + NONCE_BYTES + 16)
    throw new Error("ciphertext truncated");
  if (packed[0] !== CRYPTO_VERSION)
    throw new Error(`unsupported ciphertext version: ${packed[0]}`);

  const nonce = packed.slice(1, 1 + NONCE_BYTES);
  const ct = packed.slice(1 + NONCE_BYTES);
  const key = await deriveKey(rawKey);
  let pt: ArrayBuffer;
  try {
    pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      key,
      ct as BufferSource,
    );
  } catch {
    // AES-GCM auth failure = wrong key OR corrupted nonce/ciphertext.
    throw new Error("decryption failed: wrong key or corrupted ciphertext");
  }
  return new TextDecoder().decode(pt);
}
