// Registry conflict status. The database column also still carries the
// pre-registry values "resolved" and "archived"; both read as "ended".

export const REGISTRY_STATUSES = ["active", "reduced", "dormant", "ended"] as const;
export type RegistryStatus = (typeof REGISTRY_STATUSES)[number];

export const REGISTRY_STATUS_LABEL: Record<RegistryStatus, string> = {
  active: "Active",
  reduced: "Reduced intensity",
  dormant: "Dormant",
  ended: "Ended",
};

export function normalizeConflictStatus(status: string | null | undefined): RegistryStatus {
  switch (status) {
    case "active":
    case "reduced":
    case "dormant":
      return status;
    case "ended":
    case "resolved":
    case "archived":
      return "ended";
    default:
      return "active";
  }
}

/** Active or reduced: fighting is (still) happening, so coverage and geography matter. */
export function isLiveStatus(status: string | null | undefined): boolean {
  const s = normalizeConflictStatus(status);
  return s === "active" || s === "reduced";
}
