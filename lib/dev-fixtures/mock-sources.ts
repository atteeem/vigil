import type { SourceRef } from "@/lib/types";

type OutletPool = Omit<SourceRef, "id" | "publishedAt" | "url" | "note">;

export const OUTLET_POOL: OutletPool[] = [
  { name: "Continental Wire Service", sourceType: "Wire" },
  { name: "Meridian Press", sourceType: "Wire" },
  { name: "Regional Administration Statement", sourceType: "Official" },
  { name: "Defense Ministry Briefing", sourceType: "Official" },
  { name: "Harbor City Herald", sourceType: "Local News" },
  { name: "Frontline Daily", sourceType: "Local News" },
  { name: "OpenSky Imagery Desk", sourceType: "OSINT" },
  { name: "Maritime Watch Network", sourceType: "OSINT" },
  { name: "Independent Field Correspondent", sourceType: "Social" },
  { name: "Verified Field Post", sourceType: "Social" },
  { name: "Crisis Relief Council", sourceType: "NGO" },
  { name: "Humanitarian Monitoring Group", sourceType: "NGO" },
];
