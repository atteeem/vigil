"use client";

import Link from "next/link";
import { Search, Swords, Map as MapIcon } from "lucide-react";
import { useAppStore } from "@/hooks/use-app-store";

const ACTION = "inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border-strong px-4 text-sm font-medium text-ink hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** Ways forward from a dead end (unknown entity, failed page): search, the conflict directory, the map. */
export function RecoveryActions() {
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  return (
    <div className="mt-6 flex flex-wrap justify-center gap-2" data-testid="recovery-actions">
      <button type="button" onClick={() => setSearchOpen(true)} className={ACTION} data-testid="recovery-search">
        <Search className="h-4 w-4" aria-hidden /> Search Vigil
      </button>
      <Link href="/conflicts" className={ACTION} data-testid="recovery-conflicts">
        <Swords className="h-4 w-4" aria-hidden /> Browse conflicts
      </Link>
      <Link href="/world" className={ACTION} data-testid="recovery-map">
        <MapIcon className="h-4 w-4" aria-hidden /> Open World Map
      </Link>
    </div>
  );
}
