"use client";

import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/utils/format";

/** A timestamp shown honestly: the absolute UTC time is what is server-rendered
 * (so first paint never disagrees with the client), and once mounted it reads as
 * "N min ago" against the REAL clock, refreshing each minute. `iso` null renders
 * `fallback` ("No data"), never a made-up time. */
export function RelativeTime({ iso, fallback = "unknown", prefix, className }: { iso: string | null | undefined; fallback?: string; prefix?: string; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time clock read; SSR must not read it.
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  if (!iso) return <span className={className}>{fallback}</span>;
  const absolute = `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  return (
    <time dateTime={iso} title={absolute} className={className} suppressHydrationWarning>
      {prefix}
      {now === null ? absolute : timeAgo(iso, new Date(now).toISOString())}
    </time>
  );
}
