// P11 — SSRF + fetch-safety guard for the server-side research worker.
//
// The worker fetches provider URLs. It must never become an unrestricted
// server-side fetch primitive. This module decides, BEFORE any network call, whether
// a URL is allowed. It blocks:
//   - non http/https schemes (file://, gopher://, …)
//   - localhost / loopback / link-local / private RFC1918 ranges
//   - IP-literal hosts pointing at reserved ranges (incl. decimal/hex obfuscation
//     after URL normalization)
//   - hosts outside the configured provider allowlist
export interface ProviderRule {
  id: string;
  /** exact hostnames (and subdomains) this provider may use */
  hosts: string[];
}

export const PROVIDER_RULES: ProviderRule[] = [
  { id: "remoteok", hosts: ["remoteok.com"] },
  { id: "devpost", hosts: ["devpost.com", "api.devpost.com"] },
  { id: "hn", hosts: ["hn.algolia.com"] },
];

const PRIVATE_NETS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1\d{2}|2[0-1]\d|22[0-3])\./, // CGNAT
];

export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h === "[::1]" || h === "::1") return true;
  if (PRIVATE_NETS.some((re) => re.test(h))) return true;
  // IPv6 loopback / unique-local
  if (h.startsWith("[") && (h.includes("::1") || h.startsWith("[fc") || h.startsWith("[fd"))) return true;
  return false;
}

export type UrlVerdict =
  | { ok: true; normalized: string; provider: string }
  | { ok: false; reason: "bad_url" | "bad_scheme" | "blocked_host" | "not_allowlisted" };

/**
 * Validate a candidate fetch URL against the provider allowlist.
 * Returns a normalized URL that is safe to pass to fetch().
 */
export function validateFetchUrl(raw: string, extraRules: ProviderRule[] = []): UrlVerdict {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "bad_url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    return { ok: false, reason: "bad_scheme" };
  const host = u.hostname.toLowerCase();
  if (isBlockedHost(host)) return { ok: false, reason: "blocked_host" };

  const rules = [...PROVIDER_RULES, ...extraRules];
  const provider = rules.find((r) =>
    r.hosts.some((h) => host === h || host.endsWith("." + h)),
  );
  if (!provider) return { ok: false, reason: "not_allowlisted" };

  // Rebuild from parsed parts so any obfuscation in the original string is dropped.
  const normalized = `${u.protocol}//${host}${u.pathname}${u.search}`;
  return { ok: true, normalized, provider: provider.id };
}
