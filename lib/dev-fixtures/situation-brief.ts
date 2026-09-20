import type { Conflict, ConflictEvent } from "@/lib/types";
import { MOCK_NOW } from "./constants";

export interface SituationSnapshot {
  windowLabel: string;
  eventsInWindow: number;
  airActivity: "Low" | "Elevated" | "High";
  groundActivity: "Low" | "Elevated" | "High";
  territorialChange: string;
}

/**
 * A transparent, non-AI summary computed directly from the monitored event
 * feed — not an AI-generated narrative. Phase 2 adds AI-assisted brief
 * generation, grounded in the same stored events (see PROJECT.md, ARCHITECTURE.md).
 */
export function getSituationSnapshot(
  conflict: Conflict,
  events: ConflictEvent[],
  windowHours = 6,
): SituationSnapshot {
  const cutoff = new Date(MOCK_NOW).getTime() - windowHours * 3600_000;
  const inWindow = events.filter((e) => new Date(e.occurredAt).getTime() >= cutoff);

  const airCount = inWindow.filter((e) => e.eventType === "airstrike" || e.eventType === "drone").length;
  const groundCount = inWindow.filter((e) => e.eventType === "ground" || e.eventType === "naval").length;

  const level = (n: number): "Low" | "Elevated" | "High" =>
    n === 0 ? "Low" : n <= 2 ? "Elevated" : "High";

  return {
    windowLabel: `Last ${windowHours} Hours`,
    eventsInWindow: inWindow.length,
    airActivity: level(airCount),
    groundActivity: level(groundCount),
    territorialChange: "No major verified change",
  };
}
