"use client";

import Link from "next/link";
import { NotificationBell } from "@/components/notifications/notification-center";
import { usePathname } from "next/navigation";
import { Search, UserRound } from "lucide-react";
import { BrandMark } from "./brand-mark";
import { LiveIndicator } from "./live-indicator";
import { useAppStore } from "@/hooks/use-app-store";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, activeNavHref } from "@/lib/discovery/nav";


export function NavBar() {
  const pathname = usePathname();
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const activeHref = activeNavHref(pathname);

  return (
    <header className="fixed inset-x-0 top-0 z-50 hidden sm:block">
      <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-6 py-4">
        <Link href="/" className="shrink-0">
          <BrandMark />
        </Link>

        <nav className="flex items-center gap-1 rounded-full border border-border bg-surface/60 p-1 backdrop-blur-xl" aria-label="Primary" data-testid="primary-nav">
          {NAV_ITEMS.map((item) => {
            const active = activeHref === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                  active ? "bg-ink text-bg" : "text-ink-dim hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <LiveIndicator />
          <button
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            data-testid="header-search"
            className="flex h-9 items-center gap-2 rounded-full border border-border bg-surface/60 px-3 text-ink-dim backdrop-blur-xl transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Search className="h-4 w-4" />
            <span className="hidden text-xs lg:inline">Search</span>
            <kbd className="hidden rounded border border-border px-1 text-[10px] text-ink-faint lg:inline">Ctrl K</kbd>
          </button>
          <NotificationBell />
          <Link
            href="/profile"
            aria-label="Profile"
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface/60 text-ink-dim backdrop-blur-xl transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              pathname === "/profile" && "border-border-strong text-ink",
            )}
          >
            <UserRound className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}
