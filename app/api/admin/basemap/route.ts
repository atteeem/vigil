import { NextResponse } from "next/server";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { readBasemapConfig, resolveBasemap } from "@/lib/map/basemap";
import { probeArchive } from "@/lib/map/pmtiles-protocol";
import { MAP_BASEMAP_MODES } from "@/lib/map/style";

// Basemap diagnostics (server side): what the configuration resolves to for every mode, why a provider is or is
// not used, and — when a PMTiles archive is configured — a Range probe of the archive. No secrets are returned
// (the MapTiler key is reported only as set / not set). The browser adds what the map actually did at runtime
// (/admin/basemap merges it from localStorage).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = readBasemapConfig();
  const origin = new URL(request.url).origin;
  const resolutions = MAP_BASEMAP_MODES.map((mode) => {
    const r = resolveBasemap(mode, config);
    return { mode, active: { id: r.provider.id, label: r.provider.label, kind: r.provider.kind, attribution: r.provider.attribution, diagnostics: r.provider.diagnostics }, fallback: r.fallback, reason: r.reason, chain: r.chain };
  });
  const archiveUrl = config.pmtilesUrl ? new URL(config.pmtilesUrl, origin).toString() : null;
  const archive = archiveUrl ? await probeArchive(archiveUrl) : null;
  const dir = path.join(process.cwd(), "public", "basemaps");
  const localArchives = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".pmtiles")) : [];
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const shippedFonts = existsSync(fontsDir) ? readdirSync(fontsDir) : [];
  return NextResponse.json({
    config: { pmtilesConfigured: !!config.pmtilesUrl, pmtilesUrl: config.pmtilesUrl ?? null, maptilerKey: config.maptilerKey ? "set" : "not set", glyphsUrl: config.glyphsUrl ?? "(default: local-first)" },
    resolutions,
    archive,
    localArchives,
    glyphs: { shippedFonts, ranges: "0-255, 256-511 (Latin, Latin Extended); other scripts fall back to the remote host" },
    sprites: "not required (Vigil icons are registered by the map itself)",
  });
}
