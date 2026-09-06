// P16 — Safe MIME construction for Gmail drafts.
//
// The previous code interpolated user-controlled strings straight into a MIME blob,
// which allows CRLF header injection (a "Subject" containing \r\nBcc: attacker can
// add headers). Here every header value is sanitized and the body is folded and
// encoded so no newline in user input can ever terminate a header line.
const HEADER_SAFE = /[^\x20-\x7e]/g; // strip control chars (incl. CR/LF) and non-ASCII

/** Remove CR/LF/control chars so a value can never inject a new header. */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(HEADER_SAFE, " ").replace(/\s+/g, " ").trim();
}

/** Validate an email address loosely (must not contain CR/LF/whitespace/@-count!=1). */
export function isValidAddress(addr: string): boolean {
  if (!addr || /[\r\n\s]/.test(addr)) return false;
  const at = addr.split("@");
  if (at.length !== 2 || !at[0] || !at[1] || !at[1].includes(".")) return false;
  return addr.length <= 254;
}

/** RFC 2047 encode non-ASCII subjects; ASCII subjects pass through sanitized. */
export function encodeSubject(subject: string): string {
  const clean = sanitizeHeaderValue(subject);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  // base64 UTF-8 encoded-word
  const bytes = new TextEncoder().encode(clean);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}

/** Wrap body at 76 columns and guarantee no bare CR survives. */
function foldBody(body: string): string {
  const normalized = body.replace(/\r\n?/g, "\n");
  const out: string[] = [];
  for (const line of normalized.split("\n")) {
    if (line.length <= 76) {
      out.push(line);
      continue;
    }
    let rest = line;
    while (rest.length > 76) {
      out.push(rest.slice(0, 76));
      rest = rest.slice(76);
    }
    out.push(rest);
  }
  return out.join("\r\n");
}

export interface MimeMessage {
  to: string;
  subject: string;
  body: string;
}

/**
 * Build a minimal, safe RFC 822 message. Throws on invalid recipient so a malformed
 * `to` can never reach the Gmail API.
 */
export function buildMime(msg: MimeMessage): string {
  if (!isValidAddress(msg.to)) throw new Error("invalid recipient address");
  const headers = [
    `To: ${sanitizeHeaderValue(msg.to)}`,
    `Subject: ${encodeSubject(msg.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    "",
  ];
  return headers.join("\r\n") + foldBody(msg.body);
}

/** base64url-encode a MIME string for the Gmail API `raw` field. */
export function mimeToRaw(mime: string): string {
  const bytes = new TextEncoder().encode(mime);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
