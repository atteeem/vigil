// Imports the ACAPS "Yemen Analysis Hub - Areas of control" snapshots (published on OCHA HDX under CC BY) into Vigil as
// DRAFT territorial-control versions linked to a registry dataset. Nothing is published here: an admin approves the
// dataset in /admin/territorial-control (or POST /api/admin/territorial-datasets/{id}/publish), which is the existing
// human-review step.
//
//   BASE_URL=http://localhost:3000 node scripts/import-yemen-acaps.mjs [--snapshots 20230223,20240408,20241024,20260408]
//
// Source:   https://data.humdata.org/dataset/yemen-areas-of-control   (ACAPS, quarterly, district level, WGS84)
// Licence:  Creative Commons Attribution (CC BY) - attribution "ACAPS Yemen Analysis Hub"
// Semantics: DFA = de facto authorities, IRG = Internationally Recognised Government. This is CONTROL at district level
// (Admin-2), an analyst assessment; it is not a front line and says nothing about tactical positions.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as shapefile from "shapefile";
import polygonClipping from "polygon-clipping";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const HDX = "https://data.humdata.org/api/3/action/package_show?id=yemen-areas-of-control";
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const wanted = arg("snapshots", "20230223,20240408,20241024,20260408").split(",");
// Actor codes as ACAPS writes them. A cell can name several actors ("DFA, IRG": shared / contested) and can carry the
// token "AQAP Presence", which is PRESENCE, not control: it becomes a separate presence dataset, never control.
const ACTORS = { DFA: "De facto authorities (DFA)", IRG: "Internationally Recognised Government (IRG)", STC: "Southern Transitional Council (STC)", AQAP: "AQAP (reported presence)" };
const PRESENCE_TOKEN = /AQAP Presence/i;
const CONFIDENCE = 0.7; // ACAPS gives no per-area confidence; this is Vigil's stated default for a district-level analyst assessment

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const DECIMALS = Number(process.env.DECIMALS ?? 4);
const round = (n) => (DECIMALS >= 8 ? n : Math.round(n * 10 ** DECIMALS) / 10 ** DECIMALS);
function roundRing(ring) {
  const out = [];
  for (const [x, y] of ring) {
    const p = [round(x), round(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out.length >= 4 ? out : null;
}
function polygonsOf(geometry) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polys.map((rings) => rings.map(roundRing).filter(Boolean)).filter((rings) => rings.length > 0 && rings[0]);
}

function unzip(zip, dir) {
  mkdirSync(dir, { recursive: true });
  if (process.platform === "win32") execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dir}' -Force`]);
  else execFileSync("unzip", ["-q", "-o", zip, "-d", dir]);
}

/** District polygons by Admin-2 p-code, from the newest snapshot's shapefile (the boundaries do not change between
 * snapshots; older snapshots are published as district TABLES only, which we join to these boundaries). */
async function readDistricts(dir) {
  const shp = readdirSync(dir, { recursive: true }).find((f) => f.toLowerCase().endsWith(".shp"));
  const base = join(dir, shp.replace(/\.shp$/i, ""));
  const src = await shapefile.open(`${base}.shp`, `${base}.dbf`);
  const districts = new Map();
  while (true) {
    const r = await src.read();
    if (r.done) break;
    const p = r.value.properties;
    const pcode = String(p.ADM2_PCODE ?? p.adm2_pco_1 ?? "").trim();
    if (pcode && r.value.geometry) districts.set(pcode, polygonsOf(r.value.geometry));
  }
  return districts;
}

/** Minimal .xlsx reader: rows of { adm2 p-code -> controlling-actor code } from the first sheet. */
function readControlTable(dir) {
  const xlsx = readdirSync(dir, { recursive: true }).find((f) => f.toLowerCase().endsWith(".xlsx"));
  if (!xlsx) throw new Error("No district table (.xlsx) in this snapshot");
  const zip = join(dir, "table.zip");
  copyFileSync(join(dir, xlsx), zip);
  const out = join(dir, "xlsx");
  unzip(zip, out);
  const strings = [...readFileSync(join(out, "xl/sharedStrings.xml"), "utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join(""));
  const sheet = readFileSync(join(out, "xl/worksheets/sheet1.xml"), "utf8");
  const rows = [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => [...r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
    const v = /<v>([^<]*)<\/v>/.exec(c[2] ?? "")?.[1];
    const col = /r="([A-Z]+)/.exec(c[1])?.[1] ?? "";
    return { col, value: /t="s"/.test(c[1]) ? strings[Number(v)] : (v ?? "") };
  }));
  const header = rows[0] ?? [];
  const pcodeCol = header.find((c) => /pcode/i.test(c.value))?.col;
  const controlCol = header.find((c) => /control|actor/i.test(c.value) && !/pcode/i.test(c.value))?.col;
  if (!pcodeCol || !controlCol) throw new Error(`Unrecognised table header: ${header.map((h) => h.value).join(", ")}`);
  const table = new Map();
  for (const row of rows.slice(1)) {
    const pcode = row.find((c) => c.col === pcodeCol)?.value?.trim();
    const code = row.find((c) => c.col === controlCol)?.value?.trim();
    if (pcode && code) table.set(pcode, code);
  }
  return table;
}

async function download(resource, work, stamp) {
  const zip = join(work, `${stamp}.zip`);
  writeFileSync(zip, Buffer.from(await (await fetch(resource.url, { headers: { "User-Agent": "Vigil/1.0 (territorial dataset importer)" } })).arrayBuffer()));
  const dir = join(work, stamp);
  unzip(zip, dir);
  return dir;
}

console.log(`Fetching the HDX resource list ...`);
const pkg = (await (await fetch(HDX, { headers: { "User-Agent": "Vigil/1.0 (territorial dataset importer)" } })).json()).result;
const resources = pkg.resources.filter((r) => wanted.some((w) => r.name.startsWith(w)) && /areas of control/i.test(r.name));
if (resources.length === 0) throw new Error("None of the requested snapshots were found on HDX");
resources.sort((a, b) => a.name.localeCompare(b.name));

const conflicts = await api("/api/admin/conflicts");
const conflict = conflicts.find((c) => c.slug === "yemen-red-sea");
if (!conflict) throw new Error('Conflict "yemen-red-sea" not found');

const dataset = await api("/api/admin/territorial-datasets", {
  method: "POST",
  body: JSON.stringify({
    slug: "acaps-yemen-areas-of-control",
    name: "Yemen: Areas of control (ACAPS)",
    conflictId: conflict.id,
    countryCodes: ["YE"],
    datasetType: "TERRITORIAL_CONTROL",
    provider: "ACAPS Yemen Analysis Hub (via OCHA HDX)",
    sourceUrl: "https://data.humdata.org/dataset/yemen-areas-of-control",
    license: "Creative Commons Attribution International (CC BY)",
    attribution: "ACAPS Yemen Analysis Hub, Yemen: Areas of control, distributed on the Humanitarian Data Exchange (CC BY)",
    coverageDescription: "District-level (Admin-2) areas of control in Yemen: de facto authorities (DFA) and the Internationally Recognised Government (IRG). Quarterly analyst assessment, not a front line.",
    lastUpdated: pkg.last_modified,
    validFrom: new Date(Date.UTC(+resources[0].name.slice(0, 4), +resources[0].name.slice(4, 6) - 1, +resources[0].name.slice(6, 8))).toISOString(),
    geometryAvailability: "draft",
    actorCoverage: Object.values(ACTORS),
    confidence: CONFIDENCE,
    reviewStatus: "pending_review",
    notes: "Imported as drafts; publish from /admin/territorial-control after review. Snapshots are dated versions (validFrom = analysis date). Older snapshots (2023-2024) are ACAPS district tables joined to the newest snapshot boundaries; they record shared control (several actors per district, shown as contested) and STC, while the 2026 layer records DFA and IRG only, so category definitions differ between series.",
  }),
});
console.log(`Dataset ${dataset.slug} (${dataset.id})`);

const presenceDataset = await api("/api/admin/territorial-datasets", {
  method: "POST",
  body: JSON.stringify({
    slug: "acaps-yemen-aqap-presence",
    name: "Yemen: AQAP reported presence (ACAPS)",
    conflictId: conflict.id,
    countryCodes: ["YE"],
    datasetType: "PRESENCE",
    provider: "ACAPS Yemen Analysis Hub (via OCHA HDX)",
    sourceUrl: "https://data.humdata.org/dataset/yemen-areas-of-control",
    license: "Creative Commons Attribution International (CC BY)",
    attribution: "ACAPS Yemen Analysis Hub, Yemen: Areas of control, distributed on the Humanitarian Data Exchange (CC BY)",
    coverageDescription: "Districts where ACAPS records AQAP presence. Presence only: it is NOT control and is shown as presence.",
    lastUpdated: pkg.last_modified,
    geometryAvailability: "draft",
    actorCoverage: [ACTORS.AQAP],
    confidence: CONFIDENCE,
    reviewStatus: "pending_review",
    notes: "Only the earlier snapshots record AQAP presence; the newest shows control only. Imported as drafts for review.",
  }),
});
const actors = await api(`/api/admin/actors?conflictId=${conflict.id}`);
const actorIds = {};
for (const [code, name] of Object.entries(ACTORS)) {
  actorIds[code] = (actors.find((a) => a.name === name) ?? (await api("/api/admin/actors", { method: "POST", body: JSON.stringify({ conflictId: conflict.id, name }) }))).id;
}
const existing = await api("/api/admin/territorial-control");
const have = new Set(existing.filter((t) => t.datasetId === dataset.id).map((t) => `${t.actorId}|${t.status === "contested" ? `contested:${t.sourceName.split("shared between ")[1]?.replace(/, /g, "+")}` : Object.keys(ACTORS).find((k) => ACTORS[k] === t.actorName)}|${t.validFrom}`));
for (const t of existing.filter((t) => t.datasetId === presenceDataset.id)) have.add(`${t.actorId}|presence|${t.validFrom}`);

const work = mkdtempSync(join(tmpdir(), "vigil-yemen-"));
// District geometry from the newest snapshot that ships a shapefile.
const newest = resources[resources.length - 1];
console.log(`District boundaries from ${newest.name} ...`);
const districts = await readDistricts(await download(newest, work, "geometry"));
console.log(`  ${districts.size} districts`);

for (let i = 0; i < resources.length; i++) {
  const r = resources[i];
  const stamp = r.name.slice(0, 8);
  const validFrom = new Date(Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8)));
  const next = resources[i + 1];
  const validTo = next ? new Date(Date.UTC(+next.name.slice(0, 4), +next.name.slice(4, 6) - 1, +next.name.slice(6, 8))) : null;
  console.log(`Snapshot ${stamp}: ${(r.size / 1e6).toFixed(1)} MB`);
  const table = readControlTable(await download(r, work, stamp));
  const control = new Map(); // "DFA" | "IRG" | "STC" -> polygons; multi-actor cells -> "contested:<codes>"
  const presence = [];
  let missing = 0;
  for (const [pcode, cell] of table) {
    const polys = districts.get(pcode);
    if (!polys) {
      missing++;
      continue;
    }
    if (PRESENCE_TOKEN.test(cell)) presence.push(...polys);
    const codes = cell.replace(PRESENCE_TOKEN, "").split(/[,;/&]|and/i).map((c) => c.trim()).filter(Boolean);
    const key = codes.length === 0 ? null : codes.length === 1 ? codes[0] : `contested:${[...codes].sort().join("+")}`;
    if (key) control.set(key, [...(control.get(key) ?? []), ...polys]);
  }
  console.log(`  ${table.size} districts, ${missing} without boundaries; control: ${[...control].map(([c, p]) => `${c}=${p.length}`).join(" ")}; presence districts: ${presence.length}`);
  // District polygons touch (and some pinch): dissolve each actor's districts into clean areas with a polygon union, the
  // same library the admin editor uses. This also removes the shared district edges.
  const dissolve = (polygons) => polygonClipping.union(...polygons);
  const post = async (body) => api("/api/admin/territorial-control", { method: "POST", body: JSON.stringify({ conflictId: conflict.id, confidence: CONFIDENCE, sourceUrl: "https://data.humdata.org/dataset/yemen-areas-of-control", validFrom: validFrom.toISOString(), validTo: validTo ? validTo.toISOString() : null, ...body }) });
  for (const [key, polygons] of control) {
    const contested = key.startsWith("contested:");
    const actorId = contested ? null : actorIds[key];
    if (!contested && !actorId) {
      console.log(`  skipping unknown actor code "${key}" (${polygons.length} polygons)`);
      continue;
    }
    if (have.has(`${actorId}|${key}|${validFrom.toISOString()}`)) {
      console.log(`  ${key}: already imported`);
      continue;
    }
    await post({ actorId, status: contested ? "contested" : "controlled", territoryKind: "control", datasetId: dataset.id, geometry: { type: "MultiPolygon", coordinates: dissolve(polygons) }, sourceName: `ACAPS Yemen Analysis Hub - Areas of control (${stamp})${contested ? ` - shared between ${key.slice(10).replace(/\+/g, ", ")}` : ""}` });
    console.log(`  ${key}: draft created (${polygons.length} district polygons)`);
  }
  if (presence.length) {
    if (have.has(`${actorIds.AQAP}|presence|${validFrom.toISOString()}`)) console.log("  AQAP presence: already imported");
    else {
      await post({ actorId: actorIds.AQAP, status: "uncertain", territoryKind: "presence", datasetId: presenceDataset.id, geometry: { type: "MultiPolygon", coordinates: dissolve(presence) }, sourceName: `ACAPS Yemen Analysis Hub - Areas of control (${stamp}): AQAP presence` });
      console.log(`  AQAP presence: draft created (${presence.length} district polygons)`);
    }
  }
}
console.log("Done. The drafts are NOT published: review and publish them in /admin/territorial-control.");
