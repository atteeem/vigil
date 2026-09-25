"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Search, X, Globe2, Flame, Users, UserRound, Wrench, Newspaper, Activity, MapPin, Plane, Anchor, Waves, Radio, Shield, Clock, BellRing, TrendingUp } from "lucide-react";
import { useAppStore } from "@/hooks/use-app-store";
import { useWatches } from "@/hooks/use-watcher";
import { useCommandCenter } from "@/hooks/use-command-center";
import { readRecent, recordRecent, RECENT_EVENT, clearRecent, type RecentEntity } from "@/lib/discovery/recent";
import { SEARCH_GROUPS, type SearchResult, type SearchResultType } from "@/lib/public/search-types";
import { cn } from "@/lib/utils";

const ICON: Record<SearchResultType, React.ComponentType<{ className?: string }>> = {
  country: Globe2,
  conflict: Flame,
  actor: Users,
  unit: Shield,
  commander: UserRound,
  equipment: Wrench,
  region: MapPin,
  city: MapPin,
  event: Newspaper,
  hazard: Activity,
  airport: Plane,
  port: Anchor,
  chokepoint: Waves,
  infrastructure: Activity,
  source: Radio,
};

/** A row the palette can highlight / open: search results and the empty-state shortcuts share it. */
interface Row {
  key: string;
  title: string;
  kind: string;
  context: string | null;
  status: string | null;
  subtitle: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  recent: Omit<RecentEntity, "at"> | null;
}

const toRow = (r: SearchResult): Row => ({ key: `${r.type}:${r.id}`, title: r.title, kind: r.kind, context: r.context, status: r.status, subtitle: r.subtitle, href: r.href, icon: ICON[r.type] ?? Search, recent: { type: r.type, key: r.id, title: r.title, kind: r.kind, href: r.href } });

/** The one global search: Cmd/Ctrl+K or the header button; arrow keys, Enter and Esc; a full-width sheet on phones.
 * Queries the lightweight /api/public/search endpoint (debounced); nothing large is downloaded. */
export function CommandSearch() {
  const open = useAppStore((s) => s.searchOpen);
  const setOpen = useAppStore((s) => s.setSearchOpen);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      /* eslint-disable react-hooks/set-state-in-effect -- clearing results for a too-short query */
      setResults(null);
      setLoading(false);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/public/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (res.ok) setResults((await res.json()) as SearchResult[]);
      } catch {
        /* aborted or offline: keep the previous list */
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 140);
    return () => {
      controller.abort();
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
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- a fresh palette each time it opens */
    setQuery("");
    setResults(null);
    setActive(0);
    /* eslint-enable react-hooks/set-state-in-effect */
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const grouped = useMemo(() => {
    if (!results) return [];
    return SEARCH_GROUPS.map((g) => ({ group: g, rows: results.filter((r) => r.group === g).map(toRow) })).filter((g) => g.rows.length > 0);
  }, [results]);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const flat = results ? grouped.flatMap((g) => g.rows) : shortcuts.flatMap((s) => s.rows);

  // Keep the highlighted row in range and in view.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clamp after the list changes
    setActive((a) => (flat.length === 0 ? 0 : Math.min(a, flat.length - 1)));
  }, [flat.length]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-row-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function openRow(row: Row | undefined) {
    if (!row) return;
    if (row.recent) recordRecent(row.recent);
    setOpen(false);
    router.push(row.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      openRow(flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  let index = -1;
  const renderRow = (row: Row) => {
    index++;
    const i = index;
    const Icon = row.icon;
    return (
      <button
        key={row.key}
        type="button"
        role="option"
        aria-selected={i === active}
        data-row-index={i}
        data-testid="search-result"
        data-href={row.href}
        onMouseEnter={() => setActive(i)}
        onClick={() => openRow(row)}
        className={cn("flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left", i === active ? "bg-white/[0.07]" : "hover:bg-white/5")}
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-dim" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{row.title}</span>
          <span className="block truncate text-[11px] text-ink-faint" data-testid="search-result-meta">
            {[row.kind, row.context, row.status].filter(Boolean).join(" · ")}
            {row.subtitle ? <span className="text-ink-faint/80">{` — ${row.subtitle}`}</span> : null}
          </span>
        </span>
      </button>
    );
  };

  const q = query.trim();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-bg/70 backdrop-blur-sm sm:pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          data-testid="search-dialog"
        >
          <motion.div
            className="glass-card flex h-full w-full flex-col overflow-hidden border-border sm:h-auto sm:max-h-[70vh] sm:max-w-xl sm:rounded-2xl sm:border"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-border px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
              <Search className="h-4 w-4 text-ink-faint" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Search countries, conflicts, actors, places, airports…"
                className="flex-1 bg-transparent text-base text-ink placeholder:text-ink-faint focus:outline-none sm:text-sm"
                aria-label="Search"
                aria-controls="search-results"
                data-testid="search-input"
                autoComplete="off"
                spellCheck={false}
              />
              {loading && <span className="text-[10px] text-ink-faint">…</span>}
              <kbd className="hidden rounded border border-border px-1.5 text-[10px] text-ink-faint sm:inline">Esc</kbd>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 text-ink-faint hover:bg-white/5 hover:text-ink sm:hidden" aria-label="Close search">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div ref={listRef} id="search-results" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2" data-testid="search-results">
              {q.length >= 2 && results && grouped.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-ink-faint" data-testid="search-empty">
                  No matching entities.
                </div>
              )}
              {results &&
                grouped.map((g) => (
                  <div key={g.group} className="mb-1" data-testid={`search-group-${g.group.replace(/\s+/g, "-").toLowerCase()}`}>
                    <p className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">{g.group}</p>
                    {g.rows.map(renderRow)}
                  </div>
                ))}
              {!results && (
                <SearchShortcuts onChange={setShortcuts}>
                  {shortcuts.map((s) => (
                    <div key={s.title} className="mb-1" data-testid={s.testId}>
                      <p className="flex items-center gap-1.5 px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
                        <s.icon className="h-3 w-3" aria-hidden /> {s.title}
                      </p>
                      {s.rows.map(renderRow)}
                      {s.rows.length === 0 && <p className="px-3 pb-1 text-[11px] text-ink-faint" data-testid={`${s.testId}-empty`}>{s.empty}</p>}
                    </div>
                  ))}
                </SearchShortcuts>
              )}
            </div>
            <p className="hidden border-t border-border px-4 py-1.5 text-[10px] text-ink-faint sm:block">↑ ↓ to move · Enter to open · Esc to close · Ctrl / ⌘ K anywhere</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface Shortcut {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  rows: Row[];
  testId: string;
  empty: string;
}

/** Empty-query shortcuts: recently opened (this browser), watched (the watch system), trending (the command center's
 * Top Entities: distinct meaningful developments, never article volume). */
function SearchShortcuts({ onChange, children }: { onChange: (s: Shortcut[]) => void; children: React.ReactNode }) {
  const [recent, setRecent] = useState<RecentEntity[]>([]);
  const { data: watches } = useWatches();
  const cc = useCommandCenter();
  useEffect(() => {
    const load = () => setRecent(readRecent());
    load();
    window.addEventListener(RECENT_EVENT, load);
    return () => window.removeEventListener(RECENT_EVENT, load);
  }, []);
  const sections = useMemo(() => {
    const out: Shortcut[] = [];
    out.push({ title: "Recent", icon: Clock, testId: "search-recent", empty: "No recent searches.", rows: recent.map((r) => ({ key: `recent:${r.href}`, title: r.title, kind: r.kind, context: null, status: null, subtitle: "", href: r.href, icon: ICON[r.type as SearchResultType] ?? Clock, recent: r })) });
    out.push({ title: "Watching", icon: BellRing, testId: "search-watching", empty: "No watched entities yet.", rows: (watches ?? []).filter((w) => w.href).slice(0, 8).map((w) => ({ key: `watch:${w.entityType}:${w.entityKey}`, title: w.label, kind: w.entityType.charAt(0).toUpperCase() + w.entityType.slice(1), context: null, status: "Watching", subtitle: "", href: w.href!, icon: ICON[w.entityType as SearchResultType] ?? BellRing, recent: null })) });
    const top = cc.data?.topEntities["24h"] ?? [];
    out.push({ title: "Trending now (24h)", icon: TrendingUp, testId: "search-trending", empty: cc.isPending ? "Loading…" : "No meaningful developments in this period.", rows: top.slice(0, 6).map((t) => ({ key: `trend:${t.kind}:${t.key}`, title: t.label, kind: t.kind === "conflict" ? "Conflict" : "Country", context: null, status: `${t.developments} meaningful development${t.developments === 1 ? "" : "s"}`, subtitle: "", href: t.kind === "conflict" ? `/conflict/${t.key}` : `/country/${t.key}`, icon: t.kind === "conflict" ? Flame : Globe2, recent: null })) });
    return out;
  }, [recent, watches, cc.data, cc.isPending]);
  useEffect(() => onChange(sections), [sections, onChange]);
  const hasRecent = sections[0]!.rows.length > 0;
  return (
    <>
      {children}
      {hasRecent && (
        <button type="button" onClick={clearRecent} className="px-3 text-[10px] text-ink-faint hover:text-ink" data-testid="search-clear-recent">
          Clear recent
        </button>
      )}
      <p className="px-3 py-3 text-center text-[11px] text-ink-faint">Try “Finland”, “Ukraine war”, “RSF”, “Zhytomyr” or an airport code.</p>
    </>
  );
}
