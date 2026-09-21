"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BriefPanel } from "@/components/brief/brief-view";
import { useBriefSnapshot } from "@/hooks/use-brief";
import { EmptyState, LoadingLine } from "@/components/public/data-states";
import { BRIEF_WINDOWS, SECTION_TITLE, type BriefSection } from "@/lib/brief/types";

function SavedBrief({ id }: { id: string }) {
  const { data, status } = useBriefSnapshot(id);
  if (status === "pending") return <LoadingLine />;
  if (!data) return <EmptyState title="Saved brief not found" testId="snapshot-missing" />;
  return (
    <div data-testid="saved-brief">
      <h1 className="text-2xl font-semibold text-ink">Saved brief</h1>
      <p className="mt-1 text-sm font-medium text-ink" data-testid="saved-headline">
        {data.headline}
      </p>
      <p className="mt-0.5 text-[11px] text-ink-faint">
        Generated {new Date(data.generatedAt).toUTCString()} · covers {data.from.slice(0, 16).replace("T", " ")} → {data.to.slice(0, 16).replace("T", " ")} UTC. Kept as it was; later changes to the underlying events do not alter it.
      </p>
      <ul className="mt-4 space-y-2">
        {data.items.map((i) => (
          <li key={i.id} className="rounded-xl border border-border bg-card/60 px-4 py-3" data-testid="saved-item">
            <p className="text-[10px] uppercase tracking-wide text-ink-faint">{SECTION_TITLE[i.section as BriefSection] ?? i.section}</p>
            <p className="text-sm font-medium text-ink">{i.title}</p>
            <p className="mt-1 text-[13px] text-ink-dim">{i.summary}</p>
            <p className="mt-1 text-[11px] text-ink-faint">{i.sources.map((s) => s.name).join(" · ")}</p>
          </li>
        ))}
      </ul>
      <Link href="/brief" className="mt-6 inline-block text-sm text-accent hover:underline">
        Back to the live brief
      </Link>
    </div>
  );
}

function BriefPage() {
  const params = useSearchParams();
  const snapshot = params.get("snapshot");
  const w = params.get("window") ?? "6h";
  const initial = (BRIEF_WINDOWS as readonly string[]).includes(w) && w !== "custom" ? w : "6h";
  return (
    <main className="mx-auto max-w-[900px] px-4 pb-28 pt-24 sm:px-6 sm:pt-32" data-testid="brief-page">
      {snapshot ? <SavedBrief id={snapshot} /> : <BriefPanel scope={{}} title="Global Brief" initialWindow={initial} />}
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <BriefPage />
    </Suspense>
  );
}
