export function timeAgo(iso: string, nowIso?: string): string {
  const then = new Date(iso).getTime();
  const now = nowIso ? new Date(nowIso).getTime() : Date.now();
  const diffMs = Math.max(0, now - then);
  const minutes = Math.round(diffMs / 60000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

export function formatSigned(n: number, digits = 1): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}`;
}

export function formatCompactNumber(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact" }).format(n);
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Formats an absolute timestamp respecting the user's timezone preference
 * (Profile page). "auto" defers to the device's own timezone; any IANA
 * zone name is passed straight to Intl.DateTimeFormat.
 */
export function formatAbsoluteTime(iso: string, timezone: string): string {
  const date = new Date(iso);
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  };
  if (timezone && timezone !== "auto") {
    options.timeZone = timezone;
  }
  try {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  } catch {
    // Unknown/invalid zone — fall back to the device default rather than crash.
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  }
}
