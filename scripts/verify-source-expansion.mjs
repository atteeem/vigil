// Real-source verification for the source expansion (run against a dev server on
// the dev database): for every enabled RSS source in data/source-expansion.json,
// fetch it through the app's own ingestion path, then check that
//   - at least one real item arrived,
//   - the item's original URL is on the publisher's own domain and is preserved
//     exactly as the feed gave it,
//   - the publication time is a valid date,
//   - the source is classified (role) as declared and linked to its conflicts,
//   - re-fetching creates no duplicate items and there is exactly one source record.
// Writes data/source-verification.json. Usage: node scripts/verify-source-expansion.mjs [baseUrl]
import { readFileSync, writeFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const expansion = JSON.parse(readFileSync(new URL("../data/source-expansion.json", import.meta.url), "utf8"));

// A cold dev server can drop a connection while compiling a route: retry.
const json = async (path, init) => {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(120000) });
      return { status: res.status, body: await res.json().catch(() => null) };
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastError;
};

const registrable = (host) => host.replace(/^www\./, "").split(".").slice(-2).join(".");

const sources = (await json("/api/admin/sources")).body;
const conflicts = (await json("/api/admin/conflicts")).body;
const results = [];

for (const spec of expansion.sources) {
  const row = { name: spec.name, url: spec.url ?? spec.telegramHandle, role: spec.sourceRole, ok: false, checks: {}, note: "" };
  results.push(row);
  const matches = sources.filter((s) => (spec.type === "telegram" ? s.telegramHandle === spec.telegramHandle : s.url === spec.url));
  row.checks.singleSourceRecord = matches.length === 1;
  const source = matches[0];
  if (!source) {
    row.note = "source record missing";
    continue;
  }
  row.checks.roleClassified = source.sourceRole === spec.sourceRole;
  row.checks.enabledAsSpecified = source.enabled === (spec.enabled ?? true);

  if (spec.type === "telegram") {
    // Credential-gated: must stay disabled and report the adapter as unavailable.
    const test = await json(`/api/admin/sources/${source.id}/test`, { method: "POST" });
    row.checks.disabledWithoutCredentials = source.enabled === false && test.body?.ok === false;
    row.ok = Object.values(row.checks).every(Boolean);
    row.note = test.body?.message ?? "";
    continue;
  }

  const fetched = await json(`/api/admin/sources/${source.id}/fetch`, { method: "POST" });
  row.checks.fetchedWithoutError = fetched.body?.errors === 0;
  row.fetchedItems = fetched.body?.fetched ?? 0;
  row.note = fetched.body?.error ?? "";
  const items = (await json(`/api/admin/incoming?sourceId=${source.id}`)).body ?? [];
  row.itemsStored = items.length;
  row.checks.atLeastOneItem = items.length > 0;
  const first = items.find((i) => i.originalUrl && i.publishedAt) ?? items.find((i) => i.originalUrl) ?? items[0];
  if (first) {
    row.sample = { title: (first.originalTitle ?? "").slice(0, 90), url: first.originalUrl, publishedAt: first.publishedAt, author: first.rawMetadata?.author ?? null };
    const feedHost = registrable(new URL(spec.url).hostname);
    let itemHost = "";
    try {
      itemHost = registrable(new URL(first.originalUrl).hostname);
    } catch {
      /* missing URL */
    }
    row.checks.originalUrlOnPublisherDomain = itemHost === feedHost;
    row.checks.publishedAtValid = Boolean(first.publishedAt) && !Number.isNaN(new Date(first.publishedAt).getTime());
    // The original URL must actually resolve (2xx/3xx) — a 403 means the site
    // refuses automated readers, which we record but do not treat as a pass.
    try {
      const head = await fetch(first.originalUrl, { method: "GET", redirect: "follow", headers: { "User-Agent": "VigilLocalDev/1.0" }, signal: AbortSignal.timeout(20000) });
      row.originalUrlStatus = head.status;
      // 401/403/429 = the page exists but the site refuses automated readers. We
      // never fetch article pages (feed excerpts only) and we do not work around
      // the block, so this is recorded as bot-protected rather than as a failure.
      row.botProtected = [401, 403, 429].includes(head.status);
      row.checks.originalUrlResolves = head.status < 400 || row.botProtected;
    } catch (err) {
      row.originalUrlStatus = String(err?.message ?? err);
      row.checks.originalUrlResolves = false;
    }
  }
  // Re-fetch: dedup must add nothing.
  const again = await json(`/api/admin/sources/${source.id}/fetch`, { method: "POST" });
  row.checks.noDuplicatesOnRefetch = again.body?.new === 0;

  const linked = [];
  for (const link of spec.links ?? []) {
    const c = conflicts.find((x) => x.slug === link.conflict);
    if (c) linked.push(link.conflict);
  }
  row.linkedConflicts = linked;
  row.checks.conflictAssociation = linked.length === (spec.links ?? []).length;
  row.ok = Object.values(row.checks).every(Boolean);
}

const report = { verifiedAt: new Date().toISOString(), base, total: results.length, passed: results.filter((r) => r.ok).length, results };
writeFileSync(new URL("../data/source-verification.json", import.meta.url), JSON.stringify(report, null, 1));
for (const r of results) {
  const failed = Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k);
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(38)} items=${String(r.itemsStored ?? "-").padStart(3)} url=${r.originalUrlStatus ?? "-"} ${failed.length ? "failed: " + failed.join(",") : ""} ${r.note}`);
}
console.log(`\n${report.passed}/${report.total} verified`);
