import {
  Plane,
  Radar,
  Swords,
  Ship,
  Flame,
  Users,
  Wifi,
  Handshake,
  ShieldOff,
  CircleDot,
} from "lucide-react";
import type { EventType } from "@/lib/types";

export const EVENT_TYPE_ICON: Record<EventType, React.ComponentType<{ className?: string }>> = {
  airstrike: Plane,
  drone: Radar,
  ground: Swords,
  naval: Ship,
  terrorism: Flame,
  civil_unrest: Users,
  cyber: Wifi,
  diplomacy: Handshake,
  sanctions: ShieldOff,
  conflict: CircleDot,
};

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  airstrike: "Airstrike",
  drone: "Drone",
  ground: "Ground",
  naval: "Naval",
  terrorism: "Terrorism",
  civil_unrest: "Civil Unrest",
  cyber: "Cyber",
  diplomacy: "Diplomacy",
  sanctions: "Sanctions",
  conflict: "Conflict",
};
