import { DEFAULT_GLYPHS_URL } from "./style";
import type { AddProtocol } from "./pmtiles-protocol";

// Local-first glyphs. Vigil ships the Latin + Latin-Extended ranges (0-511) of Noto Sans Regular / Medium / Italic
// (SIL OFL 1.1, from protomaps/basemaps-assets) under /fonts. That covers every numeric label (report counts,
// cluster counts) and Latin place names with NO external request. Any other range (Cyrillic, Arabic, CJK...) is
// fetched from the configured remote glyph host. The style uses `vigil-glyphs://{fontstack}/{range}`.
// A range that exists neither locally nor remotely is counted in the diagnostics, never silently lost.

export const LOCAL_GLYPHS_URL = "vigil-glyphs://{fontstack}/{range}";
export const GLYPH_SCHEME = "vigil-glyphs";

export interface GlyphStats {
  local: number;
  remote: number;
  failed: number;
  lastFailure: string | null;
}
const g = globalThis as unknown as { __vigilGlyphs?: { registered: boolean; stats: GlyphStats } };
const state = () => (g.__vigilGlyphs ??= { registered: false, stats: { local: 0, remote: 0, failed: 0, lastFailure: null } });
export const glyphStats = (): GlyphStats => ({ ...state().stats });

/** Splits `vigil-glyphs://Noto%20Sans%20Regular/0-255` into a font stack and a range. */
export function parseGlyphUrl(url: string): { fontstack: string; range: string } | null {
  const m = /^vigil-glyphs:\/\/(.+)\/(\d+-\d+)(?:\.pbf)?$/.exec(url);
  if (!m) return null;
  let fontstack = m[1]!;
  try {
    fontstack = decodeURIComponent(fontstack);
  } catch {
    /* keep as is */
  }
  return { fontstack, range: m[2]! };
}

/** Registers the glyph protocol once. `remoteTemplate` is the fallback host for ranges Vigil does not ship. */
export function ensureGlyphProtocol(addProtocol: AddProtocol, remoteTemplate: string = DEFAULT_GLYPHS_URL, fetchImpl: typeof fetch = fetch): boolean {
  const s = state();
  if (s.registered) return false;
  s.registered = true;
  addProtocol(GLYPH_SCHEME, async (params, abortController) => {
    const parsed = parseGlyphUrl(params.url);
    const signal = (abortController as AbortController | undefined)?.signal;
    if (!parsed) {
      s.stats.failed++;
      s.stats.lastFailure = "unparseable glyph URL";
      throw new Error("Unparseable glyph URL");
    }
    // A comma-separated fontstack: the first available font wins, as MapLibre's own loader would do.
    const fonts = parsed.fontstack.split(",").map((f) => f.trim());
    for (const font of fonts) {
      try {
        const local = await fetchImpl(`/fonts/${encodeURIComponent(font)}/${parsed.range}.pbf`, { signal });
        if (local.ok && !(local.headers.get("content-type") ?? "").includes("text/html")) {
          s.stats.local++;
          return { data: await local.arrayBuffer() };
        }
      } catch {
        /* fall through to the remote host */
      }
      try {
        const remote = await fetchImpl(remoteTemplate.replace("{fontstack}", encodeURIComponent(font)).replace("{range}", parsed.range), { signal });
        if (remote.ok) {
          s.stats.remote++;
          return { data: await remote.arrayBuffer() };
        }
      } catch {
        /* try the next font */
      }
    }
    s.stats.failed++;
    s.stats.lastFailure = `${parsed.fontstack} ${parsed.range}`;
    throw new Error(`Glyphs unavailable: ${parsed.fontstack} ${parsed.range}`);
  });
  return true;
}

export function resetGlyphProtocolForTests(): void {
  delete g.__vigilGlyphs;
}
