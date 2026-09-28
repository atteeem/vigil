import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { checkUrlStructure, validateResolvedAddress, isKnownLoopbackHostname } from "@/lib/security/url-safety";

// Pre-Launch Critical Correctness & Security v1 — the one shared, hardened outbound fetch every
// server-controlled source-fetch path (RSS polling, "Test source", manual "Fetch now") uses instead of
// the bare global fetch(). DNS-rebinding safe: this resolves the hostname itself, validates every
// returned address, then connects DIRECTLY to the validated IP (never handing the hostname to the HTTP
// client to re-resolve on its own) — a naive "resolve, check, then fetch(url)" still lets an attacker's
// DNS server return a safe IP for the check and a private IP moments later for the real connection.
// Redirects are followed manually, one hop at a time, re-running this entire pipeline on each Location —
// never delegated to the HTTP client's own auto-redirect, which would bypass all of this.

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const MAX_REDIRECTS = 5;

async function resolveValidatedAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  if (isKnownLoopbackHostname(hostname)) throw new UnsafeUrlError(`"${hostname}" is a disallowed destination (loopback).`);
  const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true }).catch(() => {
    throw new UnsafeUrlError(`Could not resolve "${hostname}".`);
  });
  if (addresses.length === 0) throw new UnsafeUrlError(`"${hostname}" did not resolve to any address.`);
  for (const { address, family } of addresses) {
    const result = validateResolvedAddress(address, family as 4 | 6);
    if (!result.safe) throw new UnsafeUrlError(result.reason ?? `"${hostname}" resolved to a disallowed address.`);
  }
  return { address: addresses[0]!.address, family: addresses[0]!.family as 4 | 6 };
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  method?: "GET" | "HEAD";
}

/** Fetches one hop (no redirect following) with the connection pinned to a pre-validated IP. Exported
 * only so tests can inject a fake hop-transport into safeFetch (below) to exercise the real
 * validate-then-follow-redirect loop deterministically and offline, without opening a real socket —
 * every caller outside tests uses the default, which is this real pinned-connection implementation. */
export function fetchPinned(url: URL, ip: string, opts: SafeFetchOptions): Promise<Response> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(
      {
        // Connect to the validated IP directly; the Host header / TLS SNI still carry the real hostname
        // so virtual-hosted targets and certificate validation both work normally.
        host: ip,
        port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method: opts.method ?? "GET",
        headers: { Host: url.hostname, ...opts.headers },
        ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
        timeout: opts.timeoutMs ?? 20_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === "string") headers.set(k, v);
            else if (Array.isArray(v)) headers.set(k, v.join(", "));
          }
          resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 0, statusText: res.statusMessage ?? "", headers }));
        });
      },
    );
    req.on("timeout", () => {
      const timeoutError = new Error("Request timed out");
      timeoutError.name = "TimeoutError";
      req.destroy(timeoutError);
    });
    req.on("error", reject);
    req.end();
  });
}

/** Drop-in, SSRF-hardened replacement for `fetch(url, { headers })` for server-controlled outbound
 * source requests. Throws UnsafeUrlError (never silently "succeeds" against a blocked target) when the
 * URL, any resolved address, or any redirect target is disallowed. */
export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions = {},
  hopTransport: typeof fetchPinned = fetchPinned,
): Promise<Response> {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const structural = checkUrlStructure(currentUrl);
    if (!structural.safe) throw new UnsafeUrlError(structural.reason ?? "URL is not allowed.");
    const url = new URL(currentUrl);
    const { address } = await resolveValidatedAddress(url.hostname);
    const res = await hopTransport(url, address, opts);
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      currentUrl = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    return res;
  }
  throw new UnsafeUrlError(`Too many redirects (>${MAX_REDIRECTS}).`);
}
