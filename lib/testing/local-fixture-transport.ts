// Final Intelligence Consistency & Map Correctness v1 §3 — SSRF-vs-test-fixture regression. safeFetch()
// (lib/security/safe-fetch.ts) is correct and stays exactly as strict as it is, unconditionally, for every
// real request: no NODE_ENV bypass, no "allow localhost" switch, no hidden allowPrivate flag, no
// weakening of its DNS/redirect checks. This project's own RSS/hazard Playwright fixtures
// (app/api/test-fixtures/**) are, however, served from the SAME test server the specs run against —
// http://localhost:$TEST_PORT — which is now (correctly) an unreachable SSRF target for the real fetch
// path. Rather than touch safeFetch, this module recognizes ONLY the exact, hardcoded
// /api/test-fixtures/* path those two fixture routes already live at, and — ONLY when TEST_FIXTURES=true
// (which those routes already require to return anything but 404) AND NODE_ENV !== "production" —
// resolves the request by calling that route's own GET handler directly, in-process: no DNS lookup, no
// socket, no network stack at all. TEST_FIXTURES is never set in a real deployment, so this short-circuit
// can never activate outside the Playwright test server; every other URL, and this exact path with the
// flag unset, falls straight through to the unmodified, fully strict safeFetch path.

const FIXTURE_PATH_PREFIX = "/api/test-fixtures/";

export function isLocalFixtureUrl(rawUrl: string): boolean {
  if (process.env.TEST_FIXTURES !== "true" || process.env.NODE_ENV === "production") return false;
  try {
    return new URL(rawUrl).pathname.startsWith(FIXTURE_PATH_PREFIX);
  } catch {
    return false;
  }
}

class LocalFixtureTimeoutError extends Error {
  constructor(ms: number) {
    super(`Local fixture request timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/** Calls a test-fixture route's own GET handler in-process. Preserves real timeout semantics (the RSS
 * fixture route's own ?delayMs is a genuine `await`, so a caller-supplied timeoutMs must still be able to
 * race and lose against it, exactly like a real network call — see tests/ingestion-reliability.spec.ts). */
export async function fetchLocalFixture(rawUrl: string, opts: { timeoutMs?: number; method?: string } = {}): Promise<Response> {
  const url = new URL(rawUrl);
  const request = new Request(rawUrl, { method: opts.method ?? "GET" });

  const invoke = async (): Promise<Response> => {
    if (url.pathname.startsWith(`${FIXTURE_PATH_PREFIX}rss/`)) {
      const { GET } = await import("@/app/api/test-fixtures/rss/[name]/route");
      const name = url.pathname.slice(`${FIXTURE_PATH_PREFIX}rss/`.length);
      return GET(request, { params: Promise.resolve({ name }) });
    }
    if (url.pathname.startsWith(`${FIXTURE_PATH_PREFIX}hazards/`)) {
      const { GET } = await import("@/app/api/test-fixtures/hazards/[...path]/route");
      const path = url.pathname.slice(`${FIXTURE_PATH_PREFIX}hazards/`.length).split("/");
      return GET(request, { params: Promise.resolve({ path }) });
    }
    throw new Error(`No local fixture handler registered for ${rawUrl}`);
  };

  if (!opts.timeoutMs) return invoke();
  const timeoutMs = opts.timeoutMs;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<Response>((_, reject) => {
    timer = setTimeout(() => reject(new LocalFixtureTimeoutError(timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([invoke(), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
