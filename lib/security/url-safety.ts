// Pre-Launch Critical Correctness & Security v1 — SSRF protection. An admin-created RSS source's URL is
// fetched server-side (lib/ingestion/rss-adapter.ts) with no validation at all today: an admin (or anyone
// who compromises the admin session) could point a source at http://169.254.169.254/ (a cloud metadata
// endpoint), http://localhost:5432, an internal 10.x service, etc. and have Vigil's own server fetch it.
// This is the one shared, central URL-safety check every outbound source fetch path uses — never a
// per-caller reimplementation (spec "one central URL-safety function").

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export interface UrlSafetyResult {
  safe: boolean;
  reason?: string;
}

/** Structural checks only — scheme, credentials, syntactic hostname shape. Does NOT resolve DNS (that's
 * validateResolvedAddress below, used once per actually-resolved IP by lib/security/safe-fetch.ts). Safe
 * to call synchronously anywhere (e.g. before even attempting to save a Source in the admin UI). */
export function checkUrlStructure(rawUrl: string): UrlSafetyResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { safe: false, reason: "Malformed URL." };
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { safe: false, reason: `Protocol "${url.protocol}" is not allowed — only http/https.` };
  }
  if (url.username || url.password) {
    return { safe: false, reason: "URLs with embedded credentials are not allowed." };
  }
  return { safe: true };
}

/** IPv4 dotted-quad -> 32-bit unsigned integer, or null if not a valid dotted-quad. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function inIpv4Range(ip: string, base: string, prefixLength: number): boolean {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

// RFC 1918 private ranges, loopback, link-local, and the other reserved/special ranges an outbound
// server-side fetch must never be allowed to reach — same reasoning as any SSRF blocklist, kept as one
// small, auditable table rather than scattered conditionals.
const DISALLOWED_IPV4_RANGES: [base: string, prefix: number, label: string][] = [
  ["127.0.0.0", 8, "loopback"],
  ["10.0.0.0", 8, "RFC1918 private"],
  ["172.16.0.0", 12, "RFC1918 private"],
  ["192.168.0.0", 16, "RFC1918 private"],
  ["169.254.0.0", 16, "link-local (incl. cloud metadata)"],
  ["100.64.0.0", 10, "carrier-grade NAT (RFC6598)"],
  ["0.0.0.0", 8, "\"this network\""],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved"],
  ["192.0.0.0", 24, "IETF protocol assignments"],
  ["192.0.2.0", 24, "documentation (TEST-NET-1)"],
  ["198.18.0.0", 15, "benchmarking"],
  ["198.51.100.0", 24, "documentation (TEST-NET-2)"],
  ["203.0.113.0", 24, "documentation (TEST-NET-3)"],
  ["255.255.255.255", 32, "broadcast"],
];

function isDisallowedIpv4(ip: string): string | null {
  for (const [base, prefix, label] of DISALLOWED_IPV4_RANGES) {
    if (inIpv4Range(ip, base, prefix)) return label;
  }
  return null;
}

/** IPv6 is checked structurally (hextet prefixes), not via a full CIDR library — the ranges that matter
 * for SSRF are all simple prefixes: ::1 (loopback), fe80::/10 (link-local), fc00::/7 (unique local, the
 * IPv6 private-network equivalent), and IPv4-mapped (::ffff:a.b.c.d) addresses, which must be unwrapped
 * and re-checked against the IPv4 table above — an attacker can trivially hand back an IPv4-mapped address
 * to try to sneak a private IPv4 target past an IPv6-shaped check. */
function isDisallowedIpv6(ip: string): string | null {
  const lower = ip.toLowerCase();
  if (lower === "::1") return "loopback";
  if (lower === "::") return "unspecified";
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    const inner = isDisallowedIpv4(mapped[1]!);
    if (inner) return `IPv4-mapped ${inner}`;
    return null;
  }
  const firstHextet = lower.split(":")[0] ?? "";
  const firstNum = parseInt(firstHextet || "0", 16);
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return "link-local";
  if (firstNum >= 0xfc00 && firstNum <= 0xfdff) return "unique local (private)";
  return null;
}

/** The check that actually matters for DNS-rebinding safety: run this against every IP address a
 * hostname resolves to, not just the hostname string, and run it again for every redirect target. */
export function validateResolvedAddress(ip: string, family: 4 | 6): UrlSafetyResult {
  const reason = family === 4 ? isDisallowedIpv4(ip) : isDisallowedIpv6(ip);
  if (reason) return { safe: false, reason: `Resolved address ${ip} is a disallowed destination (${reason}).` };
  return { safe: true };
}

/** A hostname that is ITSELF a literal IP (bypassing DNS entirely) still goes through the exact same
 * range check — "localhost" is handled as a literal string here since it never reaches DNS resolution
 * consistently across platforms (some resolvers hardcode it, some don't). */
export function isKnownLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h.endsWith(".localhost");
}
