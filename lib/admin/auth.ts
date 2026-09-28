// Pre-Launch Critical Correctness & Security v1 — the admin surface (every /admin page and every
// /api/admin endpoint) previously had NO server-side authorization at all: anyone who knew or guessed a
// URL could read or mutate production data. This is a small, stateless, single-owner-beta auth boundary,
// deliberately NOT the existing localStorage consumer account system (that's client-only, per-device
// preferences, never meant to gate server access) and deliberately NOT a full multi-user auth system.
//
// Model: one shared admin password (ADMIN_PASSWORD, env-provided, never committed), checked once at
// /api/admin/login. On success, a session cookie is issued containing ONLY an expiry timestamp and an
// HMAC-SHA256 signature over it (ADMIN_SESSION_SECRET, a separate env secret) — no credential material,
// no user id, nothing meaningful to an attacker who steals the cookie beyond "logged in until this time".
// Verifying a cookie is a pure signature+expiry check (Web Crypto's SubtleCrypto, which runs identically
// in Next.js Edge middleware and in normal Node route handlers), so it needs no database and no session
// store, and middleware.ts can enforce it on every request without a DB round trip.

export const ADMIN_SESSION_COOKIE = "vigil_admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function getSessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is not set — admin auth cannot issue or verify sessions without it.");
  return secret;
}

const textEncoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Issues a new session token: base64url(expiryMs) + "." + base64url(HMAC-SHA256(expiryMs)). Carries no
 * credential material — only "authorized until this timestamp". */
export async function createAdminSessionToken(): Promise<string> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = String(expiresAt);
  const key = await hmacKey(getSessionSecret());
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(payload));
  return `${toBase64Url(textEncoder.encode(payload))}.${toBase64Url(signature)}`;
}

/** Verifies a session token's signature and expiry. Never throws on malformed input — returns false. */
export async function verifyAdminSessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadPart, signaturePart] = parts as [string, string];
  let payload: string;
  let expiresAt: number;
  try {
    payload = new TextDecoder().decode(fromBase64Url(payloadPart));
    expiresAt = Number(payload);
  } catch {
    return false;
  }
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  try {
    const key = await hmacKey(getSessionSecret());
    const signatureBytes = fromBase64Url(signaturePart);
    return await crypto.subtle.verify("HMAC", key, signatureBytes, textEncoder.encode(payload));
  } catch {
    return false;
  }
}

/** Constant-time string comparison for the password check itself (never a plain `===`, which leaks
 * timing information about how many leading characters matched). */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = textEncoder.encode(a);
  const bBytes = textEncoder.encode(b);
  // Compare against a fixed-length digest of each side so the loop length never depends on the
  // caller-supplied password's own length (a length mismatch alone must not short-circuit early).
  const len = Math.max(aBytes.length, bBytes.length, 32);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

/** Test-only bypass (spec "Existing Playwright admin tests need an explicit test-auth mechanism that
 * cannot activate in production accidentally"): requires BOTH a matching secret header AND that this is
 * not a production build — either condition alone is not enough, so a leaked/misconfigured
 * ADMIN_TEST_BYPASS_SECRET in a real deployment still can't be used while NODE_ENV=production. */
export function isTestBypass(request: Request): boolean {
  const secret = process.env.ADMIN_TEST_BYPASS_SECRET;
  if (!secret) return false;
  if (process.env.NODE_ENV === "production") return false;
  return request.headers.get("x-admin-test-bypass") === secret;
}
