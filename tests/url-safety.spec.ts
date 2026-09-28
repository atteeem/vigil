import { test, expect } from "@playwright/test";
import { checkUrlStructure, validateResolvedAddress } from "@/lib/security/url-safety";
import { safeFetch, UnsafeUrlError, type SafeFetchOptions } from "@/lib/security/safe-fetch";

// Pre-Launch Critical Correctness & Security v1 — SSRF section. Deterministic, offline coverage for the
// one shared URL-safety module every server-controlled outbound fetch (RSS polling, structured-source
// polling, "Test source", write-time Source create/update) goes through. No network access, no local
// HTTP server: literal IP addresses resolve locally in Node (no DNS query), so these run identically in
// any environment, including CI with no internet.

test.describe("URL structure checks (lib/security/url-safety.ts: checkUrlStructure)", () => {
  test("rejects a malformed URL", () => {
    expect(checkUrlStructure("not a url").safe).toBe(false);
  });

  test("rejects non-http(s) protocols", () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com/x", "gopher://example.com/x", "data:text/plain,hi"]) {
      expect(checkUrlStructure(url).safe, url).toBe(false);
    }
  });

  test("rejects embedded credentials", () => {
    expect(checkUrlStructure("https://user:pass@example.com/feed").safe).toBe(false);
  });

  test("allows an ordinary public https URL", () => {
    expect(checkUrlStructure("https://example.com/feed.xml").safe).toBe(true);
  });
});

test.describe("Resolved-address checks (lib/security/url-safety.ts: validateResolvedAddress)", () => {
  test("rejects IPv4 loopback (127.0.0.1)", () => {
    expect(validateResolvedAddress("127.0.0.1", 4).safe).toBe(false);
  });

  test("rejects RFC1918 private ranges (10.x, 172.16/12, 192.168/16)", () => {
    expect(validateResolvedAddress("10.1.2.3", 4).safe).toBe(false);
    expect(validateResolvedAddress("172.16.0.1", 4).safe).toBe(false);
    expect(validateResolvedAddress("172.31.255.255", 4).safe).toBe(false);
    expect(validateResolvedAddress("192.168.1.1", 4).safe).toBe(false);
  });

  test("does not falsely reject 172.15.x / 172.32.x (just outside the 172.16/12 block)", () => {
    expect(validateResolvedAddress("172.15.255.255", 4).safe).toBe(true);
    expect(validateResolvedAddress("172.32.0.0", 4).safe).toBe(true);
  });

  test("rejects link-local (169.254.0.0/16, incl. cloud metadata 169.254.169.254)", () => {
    expect(validateResolvedAddress("169.254.169.254", 4).safe).toBe(false);
  });

  test("rejects IPv6 loopback (::1) and link-local/unique-local", () => {
    expect(validateResolvedAddress("::1", 6).safe).toBe(false);
    expect(validateResolvedAddress("fe80::1", 6).safe).toBe(false);
    expect(validateResolvedAddress("fd00::1", 6).safe).toBe(false);
  });

  test("rejects an IPv4-mapped IPv6 address wrapping a private IPv4 target", () => {
    expect(validateResolvedAddress("::ffff:127.0.0.1", 6).safe).toBe(false);
    expect(validateResolvedAddress("::ffff:10.0.0.5", 6).safe).toBe(false);
  });

  test("allows an ordinary public IPv4/IPv6 address", () => {
    expect(validateResolvedAddress("8.8.8.8", 4).safe).toBe(true);
    expect(validateResolvedAddress("2001:4860:4860::8888", 6).safe).toBe(true);
  });
});

test.describe("safeFetch (lib/security/safe-fetch.ts): end-to-end validate-then-connect + redirect re-validation", () => {
  // These use literal public IP addresses as the URL host, so dns.promises.lookup resolves them
  // synchronously with no real DNS query, and inject a fake single-hop transport so no real socket is
  // opened either — this exercises safeFetch's actual control flow (structural check, DNS-resolved-address
  // check, redirect-target re-validation loop) fully offline and deterministically.
  function fakeTransport(script: Array<{ status: number; location?: string }>) {
    let i = 0;
    return async (_url: URL, _ip: string, _opts: SafeFetchOptions) => {
      const step = script[i]!;
      i++;
      const headers = new Headers();
      if (step.location) headers.set("location", step.location);
      return new Response("ok", { status: step.status, headers });
    };
  }

  test("rejects a direct request to a loopback/private literal IP before connecting", async () => {
    await expect(safeFetch("http://127.0.0.1/admin", {}, fakeTransport([{ status: 200 }]))).rejects.toThrow(UnsafeUrlError);
  });

  test("rejects the known localhost hostname", async () => {
    await expect(safeFetch("http://localhost:9999/", {}, fakeTransport([{ status: 200 }]))).rejects.toThrow(UnsafeUrlError);
  });

  test("allows a public-looking target and returns its response", async () => {
    const res = await safeFetch("http://8.8.8.8/feed.xml", {}, fakeTransport([{ status: 200 }]));
    expect(res.status).toBe(200);
  });

  test("follows a redirect to another public target", async () => {
    const res = await safeFetch(
      "http://8.8.8.8/feed.xml",
      {},
      fakeTransport([{ status: 302, location: "http://1.1.1.1/feed.xml" }, { status: 200 }]),
    );
    expect(res.status).toBe(200);
  });

  test("refuses a redirect from a public target to a private/loopback destination", async () => {
    await expect(
      safeFetch("http://8.8.8.8/feed.xml", {}, fakeTransport([{ status: 302, location: "http://127.0.0.1/secret" }, { status: 200 }])),
    ).rejects.toThrow(UnsafeUrlError);
  });

  test("refuses a redirect to a private RFC1918 address", async () => {
    await expect(
      safeFetch("http://8.8.8.8/feed.xml", {}, fakeTransport([{ status: 302, location: "http://10.0.0.5/internal" }, { status: 200 }])),
    ).rejects.toThrow(UnsafeUrlError);
  });
});
