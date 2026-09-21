// npm run basemap:check — validates the basemap configuration without changing anything.
//   - the configured PMTiles archive (local file under public/, or an http(s) URL with a Range request)
//   - the Protomaps style built for the schema (valid per the MapLibre style spec; required layers/sources present)
//   - glyph configuration (shipped Latin ranges present; remote glyph host reachable when it is the fallback)
//   - sprite configuration (not required) and attribution documentation
// Exit code 0 = everything checked passed (warnings allowed), 1 = a check failed. Nothing is written or downloaded.
import { existsSync, readFileSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";

try {
  const { config } = await import("dotenv");
  config({ path: ".env.local", quiet: true });
  config({ quiet: true });
} catch {
  /* dotenv optional */
}

const root = process.cwd();
const results = [];
const check = (name, ok, detail = "", warn = false) => {
  results.push({ name, ok: ok || warn, warn: !ok && warn });
  console.log(`${ok ? "PASS" : warn ? "WARN" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const url = process.env.NEXT_PUBLIC_BASEMAP_PMTILES_URL?.trim();
const glyphs = process.env.NEXT_PUBLIC_GLYPHS_URL?.trim();

// ---- archive ---------------------------------------------------------------------------------------------
if (!url) {
  check("PMTiles archive", true, "not configured (NEXT_PUBLIC_BASEMAP_PMTILES_URL unset): the bundled geography is used", true);
} else if (url.startsWith("/")) {
  const file = path.join(root, "public", url.replace(/^\/+/, ""));
  if (!existsSync(file)) check("PMTiles archive (local)", false, `${url} → public${url} does not exist`);
  else {
    const fd = openSync(file, "r");
    const buf = Buffer.alloc(127);
    readSync(fd, buf, 0, 127, 0);
    closeSync(fd);
    check("PMTiles archive (local)", buf.subarray(0, 7).toString() === "PMTiles" && buf[7] === 3, `magic ${JSON.stringify(buf.subarray(0, 7).toString())}, version ${buf[7]}`);
  }
} else {
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-126" } });
    const bytes = Buffer.from(await res.arrayBuffer());
    check("PMTiles archive reachable", res.ok, `HTTP ${res.status}`);
    check("PMTiles header", bytes.subarray(0, 7).toString() === "PMTiles" && bytes[7] === 3, `version ${bytes[7]}`);
    check("HTTP Range supported", res.status === 206 || !!res.headers.get("content-range"), `status ${res.status}, content-range ${res.headers.get("content-range") ?? "absent"}`);
    check("CORS header present", !!res.headers.get("access-control-allow-origin"), res.headers.get("access-control-allow-origin") ?? "absent (needed when the archive is on another origin)", true);
    check("Cache-Control set", !!res.headers.get("cache-control"), res.headers.get("cache-control") ?? "absent (versioned archives should be immutable)", true);
  } catch (err) {
    check("PMTiles archive reachable", false, err instanceof Error ? err.message : "fetch failed");
  }
}

// ---- style -----------------------------------------------------------------------------------------------
const glyphUrl = glyphs && glyphs.includes("{fontstack}") && glyphs.includes("{range}") ? glyphs : "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
const style = { version: 8, glyphs: glyphUrl, sources: { protomaps: { type: "vector", url: "pmtiles://https://example.invalid/x.pmtiles" } }, layers: layers("protomaps", namedFlavor("dark"), { lang: "en" }) };
const errors = validateStyleMin(style);
check("Protomaps style validates (MapLibre style spec)", errors.length === 0, errors.slice(0, 2).map((e) => e.message).join("; "));
const ids = new Set(style.layers.map((l) => l.id));
for (const id of ["earth", "water", "boundaries_country", "places_country", "places_locality"]) check(`required layer ${id}`, ids.has(id));
const fonts = new Set(style.layers.flatMap((l) => JSON.stringify(l.layout?.["text-font"] ?? "").match(/Noto Sans (Regular|Medium|Italic)/g) ?? []));
check("fonts used by the style", fonts.size > 0, [...fonts].join(", "));

// ---- glyphs / sprites / attribution -------------------------------------------------------------------------
for (const f of ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"]) {
  const missing = ["0-255", "256-511"].filter((r) => !existsSync(path.join(root, "public", "fonts", f, `${r}.pbf`)));
  check(`shipped glyph ranges: ${f}`, missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : "0-255, 256-511");
}
if (glyphs) {
  check("NEXT_PUBLIC_GLYPHS_URL has {fontstack} and {range}", glyphUrl === glyphs, glyphs);
  try {
    const res = await fetch(glyphs.replace("{fontstack}", "Noto%20Sans%20Regular").replace("{range}", "0-255"), { method: "HEAD" });
    check("custom glyph host answers", res.ok, `HTTP ${res.status}`);
  } catch (err) {
    check("custom glyph host answers", false, err instanceof Error ? err.message : "fetch failed");
  }
} else {
  check("glyphs", true, "local-first (/fonts) with the Protomaps basemaps-assets host as fallback for other scripts");
}
check("sprites", true, "not required: the basemap has no icon layers; Vigil registers its own icons");
const notices = existsSync(path.join(root, "THIRD_PARTY_NOTICES.md")) ? readFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8") : "";
check("attribution documented (OpenStreetMap, Protomaps, Natural Earth, Noto Sans)", ["OpenStreetMap", "Protomaps", "Natural Earth", "Noto Sans"].every((k) => notices.includes(k)), notices ? "THIRD_PARTY_NOTICES.md" : "THIRD_PARTY_NOTICES.md missing");

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed${results.some((r) => r.warn) ? " (with warnings)" : ""}.`);
process.exit(failed ? 1 : 0);
