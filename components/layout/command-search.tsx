"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Search, X, Globe2, Flame, Users, UserRound, Newspaper } from "lucide-react";
import { useAppStore } from "@/hooks/use-app-store";
import type { SearchResult } from "@/lib/public/search";
import { cn } from "@/lib/utils";

const ICON: Record<SearchResult["type"], React.ComponentType<{ className?: string }>> = {
  country: Globe2,
  conflict: Flame,
  actor: Users,
  commander: UserRound,
  event: Newspaper,
};

export function CommandSearch() {
  const open = useAppStore((s) => s.searchOpen);
  const setOpen = useAppStore((s) => s.setSearchOpen);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [results, setResults] = useState<SearchResult[]>([]);

  // Search runs against the real database (countries, conflicts, published events, actors).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/public/search?q=${encodeURIComponent(q)}`);
        if (res.ok && !cancelled) setResults((await res.json()) as SearchResult[]);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      // Reset the query each time the palette opens; narrow, intentional
      // UI-reset side effect paired with an imperative focus call.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-bg/70 backdrop-blur-sm sm:pt-[15vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Search"
        >
          <motion.div
            className="glass-card w-full max-w-lg overflow-hidden rounded-2xl border border-border sm:mx-4"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Search className="h-4 w-4 text-ink-faint" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search countries, conflicts, markets, events…"
                className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
                aria-label="Search"
              />
              <button
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-ink-faint hover:bg-white/5 hover:text-ink"
                aria-label="Close search"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {query && results.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-ink-faint">No results</div>
              )}
              {results.map((r) => {
                const Icon = ICON[r.type];
                return (
                  <button
                    key={`${r.type}-${r.id}`}
                    onClick={() => {
                      setOpen(false);
                      router.push(r.href);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/5",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-ink-dim" aria-hidden />
                    <span className="flex-1 truncate text-sm text-ink">{r.title}</span>
                    <span className="shrink-0 text-xs text-ink-faint">{r.subtitle}</span>
                  </button>
                );
              })}
              {!query && (
                <div className="px-3 py-6 text-center text-xs text-ink-faint">
                  Try “Ukraine”, “Oil”, “Red Sea”, or “Taiwan”
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
