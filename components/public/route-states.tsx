"use client";

import Link from "next/link";

/** Page-level failure for one intelligence page (the rest of the app keeps working). */
export function PageError({ title, reset, back }: { title: string; reset: () => void; back: { href: string; label: string } }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 pb-28 pt-24 text-center" role="alert" data-testid="route-error">
      <h1 className="text-xl font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-sm text-ink-dim">The data could not be loaded just now. This is usually temporary.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={reset} className="min-h-[44px] rounded-full bg-ink px-6 text-sm font-semibold text-bg hover:opacity-90" data-testid="route-error-retry">
          Try again
        </button>
        <Link href={back.href} className="inline-flex min-h-[44px] items-center rounded-full border border-border-strong px-5 text-sm text-ink hover:bg-card">
          {back.label}
        </Link>
      </div>
    </main>
  );
}
