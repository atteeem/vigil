import type { BriefDevelopment, BriefMapTarget } from "./types";

/** /world URL for a development: layers on, record selected, map centred, optionally the timeline moved. */
export function mapHrefFor(d: Pick<BriefDevelopment, "mapTarget" | "deepLink">, opts: { at?: boolean } = {}): string {
  const t: BriefMapTarget | null = d.mapTarget;
  if (!t) return d.deepLink;
  const p = new URLSearchParams();
  if (t.layers.length) p.set("layers", t.layers.join(","));
  if (t.hazardId) p.set("hazard", t.hazardId);
  if (t.eventId) p.set("event", t.eventId);
  if (t.territory) p.set("territory", "1");
  if (t.lat != null && t.lng != null) p.set("focus", `${t.lat.toFixed(3)},${t.lng.toFixed(3)},${t.zoom ?? 6}`);
  if (opts.at && t.at) p.set("at", t.at); // only when the brief itself is historical
  const qs = p.toString();
  return qs ? `/world?${qs}` : "/world";
}
