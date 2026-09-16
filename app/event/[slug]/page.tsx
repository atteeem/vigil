import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { getEventBySlug, MOCK_EVENTS } from "@/lib/data/mock-events";
import { EventDetailPanel } from "@/components/events/event-detail-panel";
import { EventCard } from "@/components/events/event-card";

export function generateStaticParams() {
  return MOCK_EVENTS.map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = getEventBySlug(slug);
  return { title: event ? `${event.title} — Vigil` : "Event — Vigil" };
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = getEventBySlug(slug);
  if (!event) notFound();

  const related = MOCK_EVENTS.filter(
    (e) => e.id !== event.id && e.conflictId === event.conflictId,
  ).slice(0, 4);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-28 pt-24 sm:px-6 sm:pt-32">
      <div className="rounded-2xl border border-border bg-card/70 p-6">
        <EventDetailPanel event={event} linkToFullPage={false} />
      </div>

      {related.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-ink-faint">
            <MapPin className="h-3.5 w-3.5" /> Related Events
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {related.map((e) => (
              <EventCard key={e.id} event={e} compact />
            ))}
          </div>
        </div>
      )}

      <Link href="/world" className="mt-8 inline-block text-xs text-accent hover:underline">
        ← Back to operational map
      </Link>
    </main>
  );
}
