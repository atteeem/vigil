"use client";

import { RecoveryActions } from "@/components/public/recovery-actions";

/** A page failed to render. Never shows the error text or a stack trace; offers a retry and ways forward. */
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 pb-28 pt-24 text-center" data-testid="route-error" role="alert">
      <h1 className="text-2xl font-semibold text-ink">This page could not be loaded</h1>
      <p className="mt-2 text-sm text-ink-dim">Something went wrong on our side. Your settings and watches are not affected.</p>
      <button type="button" onClick={reset} className="mt-5 min-h-[44px] rounded-full bg-ink px-6 text-sm font-semibold text-bg hover:opacity-90" data-testid="route-error-retry">
        Try again
      </button>
      <RecoveryActions />
    </main>
  );
}
