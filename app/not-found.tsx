import type { Metadata } from "next";
import { RecoveryActions } from "@/components/public/recovery-actions";

export const metadata: Metadata = { title: "Not found — Vigil" };

/** Unknown country, conflict, actor, unit or any other address. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 pb-28 pt-24 text-center" data-testid="not-found">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-ink">Not found</h1>
      <p className="mt-2 text-sm text-ink-dim">Vigil has no page at this address. The country, conflict or actor may be named differently — search finds aliases and codes.</p>
      <RecoveryActions />
    </main>
  );
}
