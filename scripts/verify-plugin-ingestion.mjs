// Fetches every ENABLED RSS source added by data/source-plugin.json through the running app
// (same path as "Fetch Now") and checks: >=1 item stored, each item keeps its own article URL
// (never the homepage/feed URL), a valid publication time, and a re-fetch adds nothing.
// Usage: node scripts/verify-plugin-ingestion.mjs [baseUrl]. Writes data/source-plugin-ingestion.json.
import { readFileSync, writeFileSync } from "node:fs";
const base = process.argv[2] ?? "http://localhost:3000";
const plugin = JSON.parse(readFileSync(new URL("../data/source-plugin.json", import.meta.url), "utf8"));
const names = new Set(plugin.sources.map((s) => s.name));
const json = async (path, init) => {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(120000) });
      return { status: res.status, body: await res.json().catch(() => null) };
    } catch (err) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error(`unreachable ${path}`);
};
const reg = (h) => h.replace(/^www\./, "").split(".").slice(-2).join(".");
const sources = (await json("/api/admin/sources")).body.filter((s) => names.has(s.name) && s.type === "rss" && s.enabled);
const results = [];
for (const s of sources) {
  const row = { name: s.name, feedUrl: s.feedUrl, ok: false, checks: {} };
  results.push(row);
  const first = await json(`/api/admin/sources/${s.id}/fetch`, { method: "POST" });
  const items = (await json(`/api/admin/incoming?sourceId=${s.id}`)).body ?? [];
  row.items = items.length;
  row.checks.fetched = first.body?.errors === 0 && items.length > 0;
  const sample = items.find((i) => i.originalUrl) ?? items[0];
  if (sample) {
    row.sample = { url: sample.originalUrl, title: (sample.originalTitle ?? "").slice(0, 80), publishedAt: sample.publishedAt };
    let host = "";
    try { host = new URL(sample.originalUrl).hostname; } catch {}
    row.checks.itemUrlIsArticle = Boolean(host) && sample.originalUrl !== s.feedUrl && new URL(sample.originalUrl).pathname.length > 1 && reg(host) === reg(new URL(s.feedUrl).hostname);
    row.checks.publishedAtValid = Boolean(sample.publishedAt) && !Number.isNaN(new Date(sample.publishedAt).getTime());
  }
  row.checks.everyItemHasOwnUrl = items.every((i) => i.originalUrl && i.originalUrl !== s.feedUrl && i.originalUrl !== s.canonicalSourceUrl);
  row.checks.noDuplicatesOnRefetch = (await json(`/api/admin/sources/${s.id}/fetch`, { method: "POST" })).body?.new === 0;
  row.ok = Object.values(row.checks).every(Boolean);
  console.log(row.ok ? "PASS" : "FAIL", s.name.padEnd(30), `items=${items.length}`, Object.entries(row.checks).filter(([, v]) => !v).map(([k]) => k).join(","));
}
writeFileSync(new URL("../data/source-plugin-ingestion.json", import.meta.url), JSON.stringify({ verifiedAt: new Date().toISOString(), total: results.length, passed: results.filter((r) => r.ok).length, results }, null, 1));
console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
