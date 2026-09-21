import { addProtocol } from "maplibre-gl";
import { ensureGlyphProtocol } from "./glyph-protocol";
import { ensurePmtilesProtocol, type AddProtocol } from "./pmtiles-protocol";

/** Browser-only. Every map that uses a basemap style calls this before creating the map; each protocol registers once. */
export function registerBasemapProtocols(): void {
  const add = addProtocol as unknown as AddProtocol;
  ensurePmtilesProtocol(add);
  ensureGlyphProtocol(add);
}
