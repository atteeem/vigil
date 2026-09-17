import {
  Plane,
  Radar,
  Rocket,
  Bomb,
  Crosshair,
  Swords,
  Ship,
  ShieldAlert,
  Megaphone,
  Flame,
  ShieldCheck,
  Siren,
  Wifi,
  Flag,
  Handshake,
  ShieldOff,
  Factory,
  Diamond,
  Activity,
  Waves,
  Tornado,
  HeartHandshake,
  Stethoscope,
  HelpCircle,
} from "lucide-react";
import type { EventType } from "@/lib/types";

export const EVENT_TYPE_ICON: Record<EventType, React.ComponentType<{ className?: string }>> = {
  airstrike: Plane,
  drone: Radar,
  missile: Rocket,
  explosion: Bomb,
  artillery: Crosshair,
  ground: Swords,
  ground_clash: Swords,
  naval: Ship,
  air_defense: ShieldAlert,
  protest: Megaphone,
  civil_unrest: Megaphone,
  fire: Flame,
  security: ShieldCheck,
  terrorism: Siren,
  cyber: Wifi,
  border: Flag,
  diplomacy: Handshake,
  sanctions: ShieldOff,
  infrastructure: Factory,
  conflict: Diamond,
  earthquake: Activity,
  flood: Waves,
  storm: Tornado,
  humanitarian: HeartHandshake,
  health: Stethoscope,
  other: HelpCircle,
};

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  airstrike: "Airstrike",
  drone: "Drone",
  missile: "Missile",
  explosion: "Explosion",
  artillery: "Artillery",
  ground: "Ground",
  ground_clash: "Ground Clash",
  naval: "Naval",
  air_defense: "Air Defense",
  protest: "Protest",
  civil_unrest: "Civil Unrest",
  fire: "Fire",
  security: "Security",
  terrorism: "Terrorism",
  cyber: "Cyber",
  border: "Border",
  diplomacy: "Diplomacy",
  sanctions: "Sanctions",
  infrastructure: "Infrastructure",
  conflict: "Conflict",
  earthquake: "Earthquake",
  flood: "Flood",
  storm: "Storm",
  humanitarian: "Humanitarian",
  health: "Health",
  other: "Other",
};

/** Safe label accessor — SQLite has no enum type (prisma/schema.prisma),
 * so a real DB row's eventType is never actually validated against the
 * EventType union at the boundary the way TypeScript assumes. Falls back
 * to "other"'s label for anything unrecognized instead of rendering
 * `undefined`. */
export function getEventTypeLabel(type: string): string {
  return (EVENT_TYPE_LABEL as Record<string, string>)[type] ?? EVENT_TYPE_LABEL.other;
}

function isEventType(type: string): type is EventType {
  return type in EVENT_TYPE_ICON;
}

/** Renders the icon for `eventType`, falling back to "other"'s icon for
 * anything unrecognized — never a blank/missing icon (same reasoning as
 * getEventTypeLabel above). A component, not a function returning a
 * component: the lookup has to happen inline against the static
 * EVENT_TYPE_ICON record for react-hooks/static-components to recognize
 * the resolved icon as stable across renders. */
export function EventTypeIcon({ eventType, className }: { eventType: string; className?: string }) {
  const Icon = isEventType(eventType) ? EVENT_TYPE_ICON[eventType] : EVENT_TYPE_ICON.other;
  return <Icon className={className} aria-hidden />;
}
