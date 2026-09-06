// P3 — Open-redirect protection.
//
// The OAuth `redirect` target is client-provided. It must NEVER become an open
// redirect. We only accept URLs whose origin is in an explicit allowlist built from
// APP_ORIGIN (+ optional comma-separated EXTRA_ORIGINS). Anything else falls back to
// APP_ORIGIN. We reject, deterministically:
//   - different hostname / origin
//   - unexpected protocol (anything but http/https)
//   - embedded credentials (user:pass@)
//   - protocol-relative URLs (//evil.com)
//   - localhost in production unless explicitly allowlisted
//   - backslash / encoded tricks that normalize to a different origin
export function trustedOrigins(appOrigin: string | undefined, extra: string | undefined): string[] {
  const list: string[] = [];
  for (const o of [appOrigin, ...(extra ?? "").split(",")]) {
    const t = (o ?? "").trim();
    if (!t) continue;
    try {
      list.push(new URL(t).origin);
    } catch {
      /* ignore malformed allowlist entries */
    }
  }
  return [...new Set(list)];
}

export function isAllowedRedirect(
  candidate: string | null | undefined,
  appOrigin: string | undefined,
  extraOrigins?: string,
  opts: { allowLocalhost?: boolean } = {},
): { ok: boolean; url: string } {
  const fallback = safeOrigin(appOrigin);
  if (!candidate || typeof candidate !== "string") return { ok: false, url: fallback };

  const trimmed = candidate.trim();
  // Protocol-relative, backslash, and control-char tricks are rejected outright.
  if (
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(trimmed) ||
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("data:")
  ) {
    return { ok: false, url: fallback };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, url: fallback };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    return { ok: false, url: fallback };
  if (parsed.username || parsed.password) return { ok: false, url: fallback };

  const host = parsed.hostname.toLowerCase();
  const isLocalhost = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (isLocalhost && !opts.allowLocalhost) {
    // localhost only allowed if explicitly present in the allowlist
    const allowed = trustedOrigins(appOrigin, extraOrigins);
    if (!allowed.includes(parsed.origin)) return { ok: false, url: fallback };
  }

  const allowed = trustedOrigins(appOrigin, extraOrigins);
  if (!allowed.includes(parsed.origin)) return { ok: false, url: fallback };

  // Return only origin + path + search. Drop hash/credentials entirely.
  const safe = `${parsed.origin}${parsed.pathname}${parsed.search}`;
  return { ok: true, url: safe };
}

function safeOrigin(appOrigin: string | undefined): string {
  try {
    return new URL(appOrigin ?? "https://localhost").origin + "/";
  } catch {
    return "https://localhost/";
  }
}
