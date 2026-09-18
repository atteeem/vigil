// Territorial Control Mode — a fixed palette assigned once per actor at
// creation time (lib/db/repositories/territorial-control.ts's
// createActor), by position among that CONFLICT's existing actors, so
// color stays stable for the life of the conflict regardless of actor
// creation/removal order elsewhere. Chosen for mutual hue separation and
// contrast against both the dark map basemap and light surfaces (WCAG
// AA against white text at the fill/outline opacities used in
// world-map.tsx) — status itself is never encoded by color alone (spec
// §3 "do not rely on color alone for meaning"), only by fill pattern/
// opacity/outline treatment, so this palette only needs to keep DIFFERENT
// ACTORS apart, not carry status meaning too.
export const ACTOR_COLOR_PALETTE = [
  "#e63946", // red
  "#2a9d8f", // teal
  "#457b9d", // steel blue
  "#f4a261", // orange
  "#8338ec", // violet
  "#ffb703", // amber
  "#3a86ff", // blue
  "#fb8500", // dark orange
  "#06d6a0", // green
  "#c9184a", // magenta
] as const;

// Areas with no clear controlling actor (contested/uncertain, actorId
// null) — deliberately outside ACTOR_COLOR_PALETTE so it can never be
// mistaken for a real actor's assigned color.
export const NO_ACTOR_COLOR = "#8a8f98";

export function nextActorColor(existingActorCount: number): string {
  return ACTOR_COLOR_PALETTE[existingActorCount % ACTOR_COLOR_PALETTE.length]!;
}
