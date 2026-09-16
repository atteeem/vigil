"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Globe2, UserCircle2, Flame, LineChart, Map } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "World", icon: Globe2 },
  { href: "/world", label: "Map", icon: Map },
  { href: "/for-you", label: "For You", icon: UserCircle2 },
  { href: "/conflicts", label: "Conflicts", icon: Flame },
  { href: "/markets", label: "Markets", icon: LineChart },
];

export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-surface/85 backdrop-blur-xl sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <div className="flex items-stretch justify-between px-1">
        {ITEMS.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
                active ? "text-ink" : "text-ink-faint",
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.1 : 1.75} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
