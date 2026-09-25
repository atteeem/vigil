"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Globe2, Gauge, FileSearch, Star, Search } from "lucide-react";
import { useAppStore } from "@/hooks/use-app-store";
import { COUNTRIES, getCountryByCode } from "@/lib/reference/countries";
import { searchCountries } from "@/lib/countries/registry";
import { IMPACT_COUNTRY_COPY, SCORE_COPY } from "@/lib/copy/scores";
import { ONBOARDING_EVENT, ONBOARDING_KEY, readOnboarding, writeOnboarding } from "@/lib/discovery/onboarding";
import { cn } from "@/lib/utils";

const STEPS = [
  { icon: Globe2, title: "Global intelligence", body: <p>Vigil combines conflicts, reports, hazards and disruptions into one live picture of the world.</p> },
  {
    icon: Gauge,
    title: "Three different scores",
    body: (
      <dl className="space-y-2">
        {(["severity", "impact", "confidence"] as const).map((k) => (
          <div key={k}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink">{SCORE_COPY[k].label}</dt>
            <dd>{SCORE_COPY[k].question}</dd>
          </div>
        ))}
      </dl>
    ),
  },
  { icon: FileSearch, title: "Source-backed", body: <p>Open any development to inspect its sources, how it was corroborated, and where each report came from.</p> },
  { icon: Star, title: "Personalize", body: <p>Watch countries, conflicts and actors to build your For You feed.</p> },
] as const;

/** First visit: a four-step introduction, then (once) the impact-country question. Stored locally; no account. */
export function FirstRun() {
  const pathname = usePathname();
  // The raw stored string is the snapshot (stable between changes); the server renders nothing.
  const raw = useSyncExternalStore(subscribe, storedSnapshot, () => null);
  const state = useMemo(() => (raw === null ? null : readOnboarding()), [raw]);
  if (!state || pathname.startsWith("/admin")) return null;
  if (!state.introDone) return <Introduction onFinish={() => writeOnboarding({ introDone: true })} />;
  if (!state.countryAsked) return <ImpactCountryPrompt onFinish={() => writeOnboarding({ countryAsked: true })} />;
  return null;
}

function subscribe(cb: () => void) {
  window.addEventListener(ONBOARDING_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(ONBOARDING_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
function storedSnapshot(): string {
  try {
    return localStorage.getItem(ONBOARDING_KEY) ?? "";
  } catch {
    return "blocked";
  }
}

function Dialog({ labelledBy, onEscape, children, testId }: { labelledBy: string; onEscape: () => void; children: React.ReactNode; testId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const escRef = useRef(onEscape);
  useEffect(() => {
    escRef.current = onEscape;
  });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") escRef.current();
      if (e.key !== "Tab" || !ref.current) return;
      // Keep keyboard focus inside the dialog.
      const f = [...ref.current.querySelectorAll<HTMLElement>("button, input, a[href]")].filter((el) => !el.hasAttribute("disabled"));
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} data-testid={testId} className="w-full max-w-md rounded-t-3xl border border-border-strong bg-surface p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl">
        {children}
      </div>
    </div>
  );
}

function Introduction({ onFinish }: { onFinish: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i]!;
  const last = i === STEPS.length - 1;
  const Icon = step.icon;
  return (
    <Dialog labelledBy="onboarding-title" onEscape={onFinish} testId="onboarding">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint" data-testid="onboarding-progress">
          Welcome to Vigil · {i + 1} of {STEPS.length}
        </span>
        {!last && (
          <button type="button" onClick={onFinish} className="rounded-full px-2 py-1 text-xs text-ink-faint hover:text-ink" data-testid="onboarding-skip">
            Skip
          </button>
        )}
      </div>
      <Icon className="mt-5 h-7 w-7 text-accent" aria-hidden />
      <h2 id="onboarding-title" className="mt-3 text-lg font-semibold text-ink" data-testid="onboarding-step-title">
        {step.title}
      </h2>
      {/* Fixed body height so Back / Next stay put between steps. */}
      <div className="mt-2 min-h-[150px] text-sm leading-relaxed text-ink-dim">{step.body}</div>
      <div className="mt-4 flex gap-1.5" aria-hidden>
        {STEPS.map((_, k) => (
          <span key={k} className={cn("h-1 flex-1 rounded-full", k <= i ? "bg-accent" : "bg-border")} />
        ))}
      </div>
      <div className="mt-6 flex items-center justify-between gap-2">
        <button type="button" onClick={() => setI(i - 1)} disabled={i === 0} className="min-h-[44px] rounded-full px-4 text-sm text-ink-dim hover:text-ink disabled:invisible" data-testid="onboarding-back">
          Back
        </button>
        <button type="button" data-autofocus onClick={() => (last ? onFinish() : setI(i + 1))} className="min-h-[44px] rounded-full bg-ink px-6 text-sm font-semibold text-bg hover:opacity-90" data-testid={last ? "onboarding-done" : "onboarding-next"}>
          {last ? "Done" : "Next"}
        </button>
      </div>
    </Dialog>
  );
}

function ImpactCountryPrompt({ onFinish }: { onFinish: () => void }) {
  const current = useAppStore((s) => s.baseCountryCode);
  const setCountry = useAppStore((s) => s.setBaseCountryCode);
  const [q, setQ] = useState("");
  // Only countries the impact model can score are offered; the registry resolves aliases and codes (Suomi, FIN, UK).
  const matches = useMemo(() => {
    const valid = (code: string) => !!getCountryByCode(code);
    if (!q.trim()) return COUNTRIES.filter((c) => c.code === current).map((c) => c.code);
    return searchCountries(q, 12)
      .map((c) => c.code)
      .filter(valid)
      .slice(0, 6);
  }, [q, current]);
  const choose = (code: string) => {
    setCountry(code);
    onFinish();
  };
  return (
    <Dialog labelledBy="impact-country-title" onEscape={onFinish} testId="impact-country-prompt">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Impact country</span>
        <button type="button" onClick={onFinish} className="rounded-full px-2 py-1 text-xs text-ink-faint hover:text-ink" data-testid="impact-country-skip">
          Skip
        </button>
      </div>
      <h2 id="impact-country-title" className="mt-4 text-lg font-semibold text-ink">
        {IMPACT_COUNTRY_COPY.question}
      </h2>
      <p className="mt-2 text-sm text-ink-dim">{IMPACT_COUNTRY_COPY.explain}</p>
      <label className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-bg/60 px-3 py-2.5">
        <Search className="h-4 w-4 text-ink-faint" aria-hidden />
        <input data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search countries" aria-label="Search countries" className="w-full bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none" data-testid="impact-country-input" />
      </label>
      <ul className="mt-2 space-y-1" role="listbox" aria-label="Countries">
        {matches.map((code) => {
          const c = getCountryByCode(code)!;
          return (
            <li key={code}>
              <button type="button" role="option" aria-selected={code === current} onClick={() => choose(code)} className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 text-left text-sm text-ink hover:bg-card focus-visible:bg-card" data-testid="impact-country-option" data-code={code}>
                <span aria-hidden>{c.flag}</span>
                {c.name}
                {code === current && !q && <span className="ml-auto text-[11px] text-ink-faint">current setting</span>}
              </button>
            </li>
          );
        })}
        {q.trim() && matches.length === 0 && <li className="px-3 py-2 text-sm text-ink-faint">No matching country.</li>}
      </ul>
      <p className="mt-4 text-[11px] text-ink-faint">
        Vigil never asks for your location. Change this any time in{" "}
        <Link href="/profile#impact-country" onClick={onFinish} className="text-accent hover:underline">
          Settings
        </Link>
        .
      </p>
    </Dialog>
  );
}
