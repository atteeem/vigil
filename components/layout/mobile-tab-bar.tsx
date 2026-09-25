"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Globe2, UserCircle2, Flame, LineChart, Map } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, activeNavHref } from "@/lib/discovery/nav";

// Same sections and active-state rule as the desktop header (lib/discovery/nav.ts).
const ICONS: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = { "/": Globe2, "/world": Map, "/for-you": UserCircle2, "/conflicts": Flame, "/markets": LineChart };
const SHORT: Record<string, string> = { "/world": "Map" };

export function MobileTabBar() {
  const pathname = usePathname();
  const activeHref = activeNavHref(pathname);
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-surface/85 backdrop-blur-xl sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <div className="flex items-stretch justify-between px-1">
        {NAV_ITEMS.map((item) => {
          const active = activeHref === item.href;
          const Icon = ICONS[item.href] ?? Globe2;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
                active ? "text-ink" : "text-ink-faint",
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.1 : 1.75} />
              {SHORT[item.href] ?? item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
