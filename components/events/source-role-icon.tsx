import { Newspaper, Landmark, Users, Rss, Radio } from "lucide-react";
import type { SourceRole } from "@/lib/types/db";

// One central source-icon mapping (mirrors event-type-icon.tsx's pattern)
// — every source renders an icon here, never a blank/missing placeholder.
// Real DB-backed sources carry a SourceRole (spec "Source Trust Model");
// mock-data sources and any source with no role set fall back to a
// generic icon via getSourceIcon() below, never an empty render.
const SOURCE_ROLE_ICON: Record<SourceRole, React.ComponentType<{ className?: string }>> = {
  originating: Newspaper,
  relay: Rss,
  official: Landmark,
  local_media: Newspaper,
  eyewitness_community: Users,
  aggregator: Rss,
};

// Single source of truth for source-role display text — also used by
// /admin/sources (its create/edit form and table), so the label never
// drifts between the two surfaces.
export const SOURCE_ROLE_LABEL: Record<SourceRole, string> = {
  originating: "Originating",
  relay: "Relay",
  official: "Official",
  local_media: "Local media",
  eyewitness_community: "Eyewitness / community",
  aggregator: "Aggregator",
};

function isSourceRole(value: string | null | undefined): value is SourceRole {
  return Boolean(value) && value! in SOURCE_ROLE_ICON;
}

export function getSourceRoleLabel(sourceRole: string | null | undefined): string | null {
  return isSourceRole(sourceRole) ? SOURCE_ROLE_LABEL[sourceRole] : null;
}

export function SourceRoleIcon({ sourceRole, className }: { sourceRole?: string | null; className?: string }) {
  // Inline record lookup (not a function call) — mirrors event-type-icon.tsx's
  // `EVENT_TYPE_ICON[event.eventType]` pattern, which react-hooks/
  // static-components requires so the resolved component reference is
  // stable/analyzable rather than opaque to the linter.
  const Icon = isSourceRole(sourceRole) ? SOURCE_ROLE_ICON[sourceRole] : Radio;
  return <Icon className={className} aria-hidden />;
}
