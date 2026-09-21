import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { BriefPanel } from "@/components/brief/brief-view";
import { normalizeCountry } from "@/lib/brief/brief";
import { FollowButton } from "@/components/watch/follow-button";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const c = normalizeCountry((await params).code);
  return { title: c ? `${c.name} brief — Vigil` : "Country brief — Vigil" };
}

export default async function CountryBriefPage({ params }: { params: Promise<{ code: string }> }) {
  const c = normalizeCountry((await params).code);
  if (!c) notFound();
  return (
    <main className="mx-auto max-w-[900px] px-4 pb-28 pt-24 sm:px-6 sm:pt-32" data-testid="country-brief-page">
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-ink-faint">
        <Link href={`/country/${c.code}`} className="hover:text-ink">
          ← {c.name}
        </Link>
        <FollowButton entityType="country" entityKey={c.code} label={c.name} />
      </div>
      <BriefPanel scope={{ country: c.code }} title={`${c.name} — Brief`} />
      <p className="mt-8 text-xs text-ink-faint" data-testid="country-brief-basis">
        Includes developments inside {c.name}, conflicts that affect {c.name} according to the impact model, and infrastructure or hazard events located there. Nothing is inferred about preferences or positions.
      </p>
    </main>
  );
}
