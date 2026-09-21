import type { StyleSpecification } from "maplibre-gl";
import { FALLBACK_STYLE, type MapBasemapMode } from "./style";
import { LOCAL_GLYPHS_URL } from "./glyph-protocol";
import { buildBundledStyle, buildPmtilesStyle, PMTILES_SOURCE_ID } from "./vigil-style";

// THE basemap authority. Everything about "which map do we draw under Vigil's intelligence layers" lives here:
// environment configuration, provider selection, the deterministic fallback order, attribution and the
// diagnostics that explain why a provider was (not) used. Map components ask `resolveBasemap()`; none of them
// contain provider-specific logic.
//
//   Open geographic data -> Protomaps-compatible basemap -> PMTiles -> MapLibre -> Vigil dynamic layers
//
// A basemap carries BASE GEOGRAPHY ONLY (land, water, borders, places). Conflicts, reports, heat, territory,
// hazards, infrastructure and actors are never baked into it; they are MapLibre sources added on top.

export type BasemapProviderId = "vigil-intel" | "vigil-street" | "external-maptiler" | "external-satellite" | "vigil-bundled" | "minimal";
export type BasemapKind = "pmtiles" | "external" | "bundled" | "minimal";

export interface BasemapConfig {
  /** NEXT_PUBLIC_BASEMAP_PMTILES_URL — https://... or a path served by this app (/basemaps/x.pmtiles). */
  pmtilesUrl?: string;
  /** NEXT_PUBLIC_MAPTILER_KEY — optional external provider (Street / Satellite / Intel when no archive is configured). */
  maptilerKey?: string;
  /** NEXT_PUBLIC_GLYPHS_URL — font PBF template with {fontstack} and {range}. */
  glyphsUrl?: string;
}

export interface BasemapProvider {
  id: BasemapProviderId;
  label: string;
  kind: BasemapKind;
  style: StyleSpecification | string;
  requiresKey: boolean;
  /** Configured and usable right now (a provider that needs a missing key is not enabled). */
  enabled: boolean;
  attribution: string[];
  /** The MapLibre source id runtime errors are matched against (null: nothing to fail remotely). */
  sourceId: string | null;
  diagnostics: { pmtilesHost?: string; styleUrlHost?: string; glyphs: string; sprites: "not required" };
}

export interface BasemapResolution {
  mode: MapBasemapMode;
  provider: BasemapProvider;
  /** Every candidate for this mode, in fallback order, with why it was skipped (if it was). */
  chain: { id: BasemapProviderId; usable: boolean; skipped: string | null }[];
  /** Why the active provider is not the first choice ("PMTiles not configured", "failed at runtime: ..."), or null. */
  reason: string | null;
  fallback: boolean;
}

/** Reads the public configuration. Empty strings count as unset; values are trimmed. With no argument it reads the
 * build-time NEXT_PUBLIC_* values (Next.js inlines only literal `process.env.NEXT_PUBLIC_X` references). */
export function readBasemapConfig(env?: Record<string, string | undefined>): BasemapConfig {
  const e = env ?? { NEXT_PUBLIC_BASEMAP_PMTILES_URL: process.env.NEXT_PUBLIC_BASEMAP_PMTILES_URL, NEXT_PUBLIC_MAPTILER_KEY: process.env.NEXT_PUBLIC_MAPTILER_KEY, NEXT_PUBLIC_GLYPHS_URL: process.env.NEXT_PUBLIC_GLYPHS_URL };
  const v = (s: string | undefined) => (s && s.trim() ? s.trim() : undefined);
  const base: BasemapConfig = { pmtilesUrl: v(e.NEXT_PUBLIC_BASEMAP_PMTILES_URL), maptilerKey: v(e.NEXT_PUBLIC_MAPTILER_KEY), glyphsUrl: v(e.NEXT_PUBLIC_GLYPHS_URL) };
  // Development/test only (never in a production build): localStorage["vigil.basemap.config"] overrides the build-time
  // values, so failure handling (a 404 archive, a bad file) can be exercised without rebuilding.
  if (!env && process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    try {
      const o = JSON.parse(window.localStorage.getItem("vigil.basemap.config") ?? "{}") as BasemapConfig;
      return { pmtilesUrl: v(o.pmtilesUrl) ?? base.pmtilesUrl, maptilerKey: v(o.maptilerKey) ?? base.maptilerKey, glyphsUrl: v(o.glyphsUrl) ?? base.glyphsUrl };
    } catch {
      /* no override */
    }
  }
  return base;
}

export const getMapTilerKey = (): string | undefined => readBasemapConfig().maptilerKey;

const MAPTILER_STYLE_ID: Record<MapBasemapMode, string> = { intel: "dataviz-dark", street: "streets-v2", satellite: "hybrid" };
const hostOf = (url: string) => {
  try {
    return new URL(url, "http://local.invalid").host.replace("local.invalid", "(this app)");
  } catch {
    return "(invalid URL)";
  }
};

const OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const PROTOMAPS = '<a href="https://protomaps.com">Protomaps</a>';
const NATURAL_EARTH = "Natural Earth";

function make(id: BasemapProviderId, config: BasemapConfig, glyphs: string): BasemapProvider | null {
  const diag = { glyphs: glyphs === LOCAL_GLYPHS_URL ? "local-first (/fonts Latin ranges, remote host for other scripts)" : `custom host ${hostOf(glyphs.replace("{fontstack}", "x").replace("{range}", "0-255"))}`, sprites: "not required" as const };
  switch (id) {
    case "vigil-intel":
    case "vigil-street": {
      if (!config.pmtilesUrl) return null;
      return { id, label: id === "vigil-intel" ? "Vigil Intel (PMTiles)" : "Vigil Street (PMTiles)", kind: "pmtiles", style: buildPmtilesStyle(id === "vigil-intel" ? "intel" : "street", config.pmtilesUrl, glyphs), requiresKey: false, enabled: true, attribution: [`${PROTOMAPS} ${OSM}`, NATURAL_EARTH], sourceId: PMTILES_SOURCE_ID, diagnostics: { ...diag, pmtilesHost: hostOf(config.pmtilesUrl) } };
    }
    case "external-maptiler":
    case "external-satellite": {
      if (!config.maptilerKey) return null;
      const mode: MapBasemapMode = id === "external-satellite" ? "satellite" : "intel";
      return { id, label: id === "external-satellite" ? "MapTiler hybrid satellite" : "MapTiler", kind: "external", style: `https://api.maptiler.com/maps/${MAPTILER_STYLE_ID[mode]}/style.json?key=${config.maptilerKey}`, requiresKey: true, enabled: true, attribution: ["© MapTiler © OpenStreetMap contributors"], sourceId: "vigil-basemap", diagnostics: { ...diag, styleUrlHost: "api.maptiler.com" } };
    }
    case "vigil-bundled":
      return { id, label: "Vigil bundled geography", kind: "bundled", style: buildBundledStyle(glyphs), requiresKey: false, enabled: true, attribution: [`${NATURAL_EARTH} (public domain)`], sourceId: null, diagnostics: diag };
    case "minimal":
      return { id, label: "Minimal (no basemap)", kind: "minimal", style: { ...FALLBACK_STYLE, glyphs }, requiresKey: false, enabled: true, attribution: [], sourceId: null, diagnostics: diag };
  }
}

/** The ordered candidates for a mode. MapTiler stays available for the modes that need imagery/streets, but no
 * mode REQUIRES it: the bundled geography and the minimal style always terminate the chain. */
function candidatesFor(mode: MapBasemapMode, config: BasemapConfig): { id: BasemapProviderId; skip: string | null }[] {
  const pm = config.pmtilesUrl ? null : "NEXT_PUBLIC_BASEMAP_PMTILES_URL is not set";
  const key = config.maptilerKey ? null : "NEXT_PUBLIC_MAPTILER_KEY is not set";
  if (mode === "satellite") {
    return [
      { id: "external-satellite", skip: key ? `${key} (imagery needs an external provider)` : null },
      { id: "vigil-bundled", skip: null },
      { id: "minimal", skip: null },
    ];
  }
  return [
    { id: mode === "intel" ? "vigil-intel" : "vigil-street", skip: pm },
    { id: "external-maptiler", skip: key },
    { id: "vigil-bundled", skip: null },
    { id: "minimal", skip: null },
  ];
}

/**
 * Resolves the basemap for a mode. `failed` lists providers that already failed at runtime (a 404 archive, a
 * broken style): they are skipped, so a fallback happens at most once per provider — never an endless retry.
 * The chain always ends in the bundled geography, then a minimal style: the map is never blank.
 */
export function resolveBasemap(mode: MapBasemapMode, config: BasemapConfig = readBasemapConfig(), failed: Partial<Record<BasemapProviderId, string>> = {}): BasemapResolution {
  // Glyphs: a valid NEXT_PUBLIC_GLYPHS_URL wins; otherwise local-first (shipped Latin ranges, remote host for the rest).
  const custom = config.glyphsUrl && config.glyphsUrl.includes("{fontstack}") && config.glyphsUrl.includes("{range}") ? config.glyphsUrl : null;
  const glyphs = custom ?? LOCAL_GLYPHS_URL;
  const candidates = candidatesFor(mode, config);
  const chain: BasemapResolution["chain"] = [];
  let chosen: BasemapProvider | null = null;
  let reason: string | null = null;
  for (const c of candidates) {
    if (failed[c.id]) {
      chain.push({ id: c.id, usable: false, skipped: `failed at runtime: ${failed[c.id]}` });
      reason ??= `${c.id} failed at runtime: ${failed[c.id]}`;
      continue;
    }
    if (c.skip) {
      chain.push({ id: c.id, usable: false, skipped: c.skip });
      if (!chosen && chain.length === 1) reason = c.skip;
      continue;
    }
    const provider = make(c.id, config, glyphs);
    if (!provider) {
      chain.push({ id: c.id, usable: false, skipped: "not configured" });
      continue;
    }
    chain.push({ id: c.id, usable: true, skipped: null });
    chosen ??= provider;
  }
  // `minimal` is always constructible, so `chosen` is never null.
  const provider = chosen ?? make("minimal", config, glyphs)!;
  const firstUsable = chain.find((c) => c.usable)?.id;
  const primary = candidates[0]!.id;
  return { mode, provider, chain, reason: provider.id === primary ? null : (reason ?? `${primary} unavailable`), fallback: firstUsable !== undefined && provider.id !== primary };
}

/** Convenience for components that only need a style (editors, previews): same authority, no diagnostics. */
export const getBasemapStyle = (mode: MapBasemapMode = "intel", config: BasemapConfig = readBasemapConfig()): StyleSpecification | string => resolveBasemap(mode, config).provider.style;

/** Explains an archive-probe or map error in one line, without leaking keys or full URLs. */
export function safeReason(message: string): string {
  return message.replace(/([?&](?:key|token|access_token)=)[^&\s]+/gi, "$1***").slice(0, 200);
}
