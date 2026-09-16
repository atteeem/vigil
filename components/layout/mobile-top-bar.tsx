"use client";

import Link from "next/link";
import { Search, UserRound } from "lucide-react";
import { BrandMark } from "./brand-mark";
import { LiveIndicator } from "./live-indicator";
import { useAppStore } from "@/hooks/use-app-store";

export function MobileTopBar() {
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  return (
    <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between px-4 pt-4 sm:hidden">
      <Link href="/">
        <BrandMark />
      </Link>
      <div className="flex items-center gap-2">
        <LiveIndicator />
        <button
          onClick={() => setSearchOpen(true)}
          aria-label="Search"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface/60 text-ink-dim backdrop-blur-xl"
        >
          <Search className="h-4 w-4" />
        </button>
        <Link
          href="/profile"
          aria-label="Profile"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface/60 text-ink-dim backdrop-blur-xl"
        >
          <UserRound className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
