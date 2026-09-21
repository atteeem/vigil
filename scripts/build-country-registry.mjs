// Generates data/countries.json: the canonical country registry (identity, aliases, region, subregion,
// capital, centroid, land-border neighbours, landlocked flag).
//   node scripts/build-country-registry.mjs
// Identity facts come from scripts/country-table.mjs; borders come from Natural Earth geometry
// (world-atlas 110m, shared arcs) united with the curated pairs already used by impact scoring and a few
// micro-state pairs; centroids prefer the values impact scoring already used, then Natural Earth label
// points (data/country-centroids.json), then the geometry centroid.
import { readFileSync, writeFileSync } from "node:fs";
import { feature, neighbors } from "topojson-client";
import { geoCentroid, geoBounds } from "d3-geo";
import { TABLE, ALIASES, LANDLOCKED, ATLAS_NAMES, EXTRA_BORDERS, SMALL_CENTROIDS, CURATED_BORDERS } from "./country-table.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const rows = TABLE.trim().split("\n").map((l) => l.split("|"));
const byCode = new Map(rows.map(([code, alpha3, name, region, subregion, capital]) => [code, { code, alpha3, name, region, subregion, capital }]));
const byName = new Map(rows.map(([code, , name]) => [name.toLowerCase(), code]));

// Values the scoring engine already used for its original reference countries (kept exactly).
const oldRef = {};
let legacy = "";
try { legacy = read("lib/reference/countries.ts"); } catch {}
for (const m of legacy.matchAll(/\{ code: "([A-Z]{2})", name: "[^"]+", region: "[^"]+", lat: ([-\d.]+), lng: ([-\d.]+), population: ([\d_]+)/g)) oldRef[m[1]] = { lat: Number(m[2]), lng: Number(m[3]), population: Number(m[4].replaceAll("_", "")) };
// Re-running keeps the reference values already recorded (the pre-registry table no longer exists).
try { for (const c of JSON.parse(read("data/countries.json")).countries) if (c.population != null && !oldRef[c.code]) oldRef[c.code] = { lat: c.lat, lng: c.lng, population: c.population }; } catch {}
const curated = CURATED_BORDERS;
const centroids = JSON.parse(read("data/country-centroids.json"));

const topo = JSON.parse(readFileSync(new URL("../node_modules/world-atlas/countries-110m.json", import.meta.url), "utf8"));
const geoms = topo.objects.countries.geometries;
const feats = feature(topo, topo.objects.countries).features;
const nb = neighbors(geoms);
const codeOf = (g) => {
  const name = g.properties.name;
  if (name in ATLAS_NAMES) return ATLAS_NAMES[name];
  return byName.get(name.toLowerCase()) ?? undefined;
};
const codes = geoms.map(codeOf);
const unmatched = [...new Set(geoms.filter((g, i) => codes[i] === undefined).map((g) => g.properties.name))];
if (unmatched.length) console.warn("unmatched atlas names:", unmatched.join(", "));

const borders = new Map();
const link = (a, b) => {
  if (!a || !b || a === b || !byCode.has(a) || !byCode.has(b)) return;
  (borders.get(a) ?? borders.set(a, new Set()).get(a)).add(b);
  (borders.get(b) ?? borders.set(b, new Set()).get(b)).add(a);
};
nb.forEach((list, i) => list.forEach((j) => link(codes[i], codes[j])));
for (const [a, b] of [...curated, ...EXTRA_BORDERS]) link(a, b);

const geoCentroids = new Map();
const zooms = new Map();
feats.forEach((f, i) => {
  const c = codes[i];
  if (!c || geoCentroids.has(c)) return;
  geoCentroids.set(c, geoCentroid(f));
  // Map framing: from the geometry's extent (largest span in degrees), clamped so huge/multi-part states stay usable.
  const [[w, so], [e, n]] = geoBounds(f);
  const span = Math.max(Math.min(Math.abs(e - w), 360 - Math.abs(e - w) > 0 ? Math.abs(e - w) : 360), n - so, 0.5);
  zooms.set(c, Math.round(Math.max(2.5, Math.min(8, Math.log2(360 / Math.min(span, 90)) + 0.3)) * 2) / 2);
});

const flag = (code) => String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
const round = (n) => Math.round(n * 10000) / 10000;
const countries = [...byCode.values()].map((c) => {
  const old = oldRef[c.code];
  const cen = centroids[c.code] ?? SMALL_CENTROIDS[c.code];
  const geo = geoCentroids.get(c.code);
  const lat = old?.lat ?? cen?.[0] ?? (geo ? geo[1] : null);
  const lng = old?.lng ?? cen?.[1] ?? (geo ? geo[0] : null);
  return { ...c, aliases: ALIASES[c.code] ?? [], lat: lat == null ? null : round(lat), lng: lng == null ? null : round(lng), population: old?.population ?? null, flag: flag(c.code), landlocked: LANDLOCKED.includes(c.code), zoom: zooms.get(c.code) ?? 8, borders: [...(borders.get(c.code) ?? [])].sort() };
}).sort((a, b) => a.name.localeCompare(b.name));

const missing = countries.filter((c) => c.lat == null).map((c) => c.code);
if (missing.length) console.warn("no centroid for:", missing.join(", "));
writeFileSync(new URL("../data/countries.json", import.meta.url), JSON.stringify({ meta: { generatedBy: "scripts/build-country-registry.mjs", identity: "ISO 3166-1 (static table)", borders: "Natural Earth 110m (world-atlas) shared arcs + curated pairs + micro-state pairs", centroids: "scoring reference values, then Natural Earth label points, then geometry centroid", populationNote: "population is recorded only where a sourced value already existed; otherwise null" }, countries }, null, 1));
console.log(`wrote ${countries.length} countries; borders: ${countries.reduce((s, c) => s + c.borders.length, 0) / 2} pairs`);
