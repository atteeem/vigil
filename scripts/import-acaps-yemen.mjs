#!/usr/bin/env node
// Imports ACAPS "Yemen: Areas of control" (HDX, CC BY 4.0) into data/territorial/acaps-yemen-areas-of-control.json.
//
//   node scripts/import-acaps-yemen.mjs            # newest snapshot(s) in the current schema
//   node scripts/import-acaps-yemen.mjs --all      # every snapshot in the current schema
//
// What the source measures: ACAPS's Yemen Analysis Hub classifies every Admin-2 district as controlled by the de facto
// authorities (DFA, Ansar Allah / Houthis) or the internationally recognised government (IRG). It is a district-level
// CONTROL classification (a whole district goes to one side), published as dated snapshots. This script:
//   1. lists the dataset's resources through the HDX API (no scraping),
//   2. downloads each snapshot zip and finds the district shapefile with the `areas_of_c` field (the current schema;
//      older snapshots use separate per-actor files with a different taxonomy - STC control, AQAP presence - and are
//      reported and skipped, never merged into this taxonomy),
//   3. dissolves the districts per actor, simplifies to strategic level (about 200 m) and repairs the result,
//   4. keeps a snapshot only when the district assignment differs from the previous kept one (identical re-publications
//      are not "changes"),
//   5. writes the versions with full provenance. The seed loads them as UNPUBLISHED drafts: a human approves them in
//      /admin/territorial-control (coverage) before anything reaches the public map.

import fs from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import * as shapefile from "shapefile";
import polygonClipping from "polygon-clipping";

const DATASET = "yemen-areas-of-control";
const API = `https://data.humdata.org/api/3/action/package_show?id=${DATASET}`;
const OUT = path.join(process.cwd(), "data", "territorial", "acaps-yemen-areas-of-control.json");
const TOLERANCE = 0.002; // degrees, ~200 m: strategic level, well below district size
const ACTORS = {
  DFA: "De facto authorities (Ansar Allah / Houthis)",
  IRG: "Internationally recognised government (IRG)",
};
const all = process.argv.includes("--all");

const snapshotDate = (name) => {
  const m = /^(\d{4})(\d{2})(\d{2})\b/.exec(name.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/** Every file in a zip, descending into nested zips. */
function unzipDeep(bytes, prefix = "") {
  const out = {};
  for (const [name, data] of Object.entries(unzipSync(bytes))) {
    if (name.toLowerCase().endsWith(".zip")) Object.assign(out, unzipDeep(data, `${prefix}${name}/`));
    else out[`${prefix}${name}`] = data;
  }
  return out;
}

// ---- geometry --------------------------------------------------------------------------------------------------
function perpDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function douglasPeucker(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let max = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i], pts[s], pts[e]);
      if (d > max) (max = d), (idx = i);
    }
    if (max > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
const round = (x) => Math.round(x * 1e5) / 1e5;
function simplifyMulti(multi) {
  const simplified = [];
  for (const poly of multi) {
    const rings = [];
    for (const ring of poly) {
      const open = ring.slice(0, -1);
      const s = douglasPeucker(open, TOLERANCE).map(([x, y]) => [round(x), round(y)]);
      if (s.length >= 3) rings.push([...s, s[0]]);
    }
    if (rings.length && rings[0].length >= 4) simplified.push(rings);
  }
  // Re-union repairs any self-intersection the simplification introduced and drops slivers.
  const repaired = polygonClipping.union(...simplified.map((p) => [p]));
  // Drop specks smaller than ~1 km2 (an islet reduced to a few vertices), strategic level only.
  const area = (ring) => Math.abs(ring.reduce((s, p, i) => (i ? s + (ring[i - 1][0] * p[1] - p[0] * ring[i - 1][1]) : s), 0) / 2);
  return repaired.filter((p) => area(p[0]) > 1e-4);
}
const vertexCount = (multi) => multi.reduce((s, p) => s + p.reduce((t, r) => t + r.length, 0), 0);

async function readSnapshot(resource) {
  const res = await fetch(resource.url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const files = unzipDeep(new Uint8Array(await res.arrayBuffer()));
  for (const name of Object.keys(files).filter((n) => n.toLowerCase().endsWith(".shp"))) {
    const base = name.slice(0, -4);
    const dbf = files[`${base}.dbf`] ?? files[`${base}.DBF`];
    if (!dbf) continue;
    const fc = await shapefile.read(files[name].buffer.slice(files[name].byteOffset, files[name].byteOffset + files[name].byteLength), dbf.buffer.slice(dbf.byteOffset, dbf.byteOffset + dbf.byteLength));
    if (!fc.features.length || !("areas_of_c" in fc.features[0].properties)) continue;
    return fc;
  }
  return null;
}

async function main() {
  const pkg = (await (await fetch(API)).json()).result;
  const snapshots = pkg.resources
    .map((r) => ({ id: r.id, name: r.name, url: r.url, date: snapshotDate(r.name), lastModified: r.last_modified }))
    .filter((r) => r.date)
    .sort((a, b) => b.date.localeCompare(a.date));
  const versions = [];
  const skipped = [];
  for (const snap of snapshots) {
    process.stdout.write(`${snap.date} ${snap.name} ... `);
    const fc = await readSnapshot(snap);
    if (!fc) {
      console.log("different schema (per-actor files), skipped");
      skipped.push({ date: snap.date, resourceId: snap.id, reason: "older schema: separate per-actor shapefiles (incl. STC control and AQAP presence); not merged into the DFA / IRG taxonomy" });
      if (!all && versions.length) break;
      continue;
    }
    const byActor = {};
    const districts = {};
    for (const f of fc.features) {
      const code = f.properties.areas_of_c;
      if (!ACTORS[code]) throw new Error(`unknown actor code ${code}`);
      (byActor[code] ??= []).push(f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates);
      districts[f.properties.ADM2_PCODE] = code;
    }
    const actors = Object.entries(byActor).map(([code, parts]) => {
      const dissolved = polygonClipping.union(...parts);
      const simplified = simplifyMulti(dissolved);
      return { code, name: ACTORS[code], districtCount: parts.length, geometry: { type: "MultiPolygon", coordinates: simplified }, vertices: vertexCount(simplified) };
    });
    const previous = versions.at(-1);
    const signature = JSON.stringify(Object.entries(districts).sort());
    if (previous && previous.signature === signature) {
      console.log("same district assignment as the next newer snapshot, folded into it");
      previous.validFrom = snap.date;
      continue;
    }
    console.log(actors.map((a) => `${a.code}: ${a.districtCount} districts, ${a.vertices} vertices`).join("; "));
    versions.push({ snapshot: snap.date, validFrom: snap.date, resourceId: snap.id, resourceName: snap.name, resourceUrl: snap.url, signature, districtCount: Object.keys(districts).length, actors: actors.map(({ vertices, ...a }) => a) });
    if (!all) break;
  }
  versions.reverse(); // oldest first
  const out = {
    source: {
      provider: "ACAPS (Yemen Analysis Hub)",
      datasetUrl: `https://data.humdata.org/dataset/${DATASET}`,
      license: "CC BY 4.0",
      attribution: "Areas of control: ACAPS Yemen Analysis Hub, via HDX (CC BY 4.0). Dissolved to one area per actor and simplified by Vigil.",
      measures: "District-level (Admin 2) classification of de facto control, DFA vs IRG. A whole district is assigned to one side.",
      importedAt: new Date().toISOString(),
      simplificationToleranceDegrees: TOLERANCE,
    },
    versions: versions.map(({ signature, ...v }) => v),
    skipped,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`wrote ${OUT} (${versions.length} version(s), ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
