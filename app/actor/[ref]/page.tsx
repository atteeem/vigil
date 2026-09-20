import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getPublicActor } from "@/lib/public/actors";
import { EmptyState } from "@/components/public/data-states";
import { RelativeTime } from "@/components/ui/relative-time";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }): Promise<Metadata> {
  const { ref } = await params;
  const actor = await getPublicActor(ref);
  return { title: actor ? `${actor.name} — Vigil` : "Actor — Vigil" };
}

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId: string }) {
  return (
    <section className="mt-6" data-testid={testId}>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{title}</h2>
      {children}
    </section>
  );
}

/** Simple real-data actor page: canonical name, aliases, conflicts, related events,
 * unit relationships, equipment/commanders, and where the record came from. Sections
 * with no stored data say so; nothing is filled in. */
export default async function ActorPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const actor = await getPublicActor(ref);
  if (!actor) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 pb-28 pt-24 sm:px-6 sm:pt-32" data-testid="actor-page">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">{actor.kind === "unit" ? "Armed actor" : "Territorial-control actor"}</p>
      <h1 className="mt-1 text-2xl font-semibold text-ink" data-testid="actor-name">
        {actor.name}
      </h1>
      <p className="mt-1 text-xs text-ink-dim">{[actor.branch, actor.unitType, actor.status].filter(Boolean).join(" · ") || "No further classification recorded"}</p>

      <Section title="Also known as" testId="actor-aliases">
        {actor.aliases.length > 0 ? <p className="text-sm text-ink-dim">{actor.aliases.join(", ")}</p> : <EmptyState title="No aliases recorded" />}
      </Section>

      <Section title="Conflicts" testId="actor-conflicts">
        {actor.conflicts.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {actor.conflicts.map((c) => (
              <li key={c.slug}>
                <Link href={`/conflict/${c.slug}`} className="text-accent hover:underline">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Not linked to a conflict yet" />
        )}
      </Section>

      {actor.territory && (
        <Section title="Territorial control" testId="actor-territory">
          <p className="text-sm text-ink-dim">
            {actor.territory.areas > 0
              ? `Currently recorded as controlling ${actor.territory.areas} published area${actor.territory.areas === 1 ? "" : "s"} in `
              : "No published territorial areas currently recorded in "}
            <Link href={`/conflict/${actor.territory.conflictSlug}`} className="text-accent hover:underline">
              {actor.territory.conflictName}
            </Link>
            .
          </p>
        </Section>
      )}

      <Section title="Related events" testId="actor-events">
        {actor.events.length > 0 ? (
          <ul className="space-y-1.5 text-sm">
            {actor.events.map((e) => (
              <li key={e.slug}>
                <Link href={`/event/${e.slug}`} className="text-accent hover:underline">
                  {e.title}
                </Link>{" "}
                <span className="text-xs text-ink-faint">
                  <RelativeTime iso={e.occurredAt} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No published events linked yet" />
        )}
      </Section>

      {actor.kind === "unit" && (
        <Section title="Structure" testId="actor-structure">
          {actor.parent || actor.children.length > 0 ? (
            <div className="space-y-1 text-sm text-ink-dim">
              {actor.parent && (
                <p>
                  Part of{" "}
                  <Link href={`/actor/${encodeURIComponent(actor.parent.id)}`} className="text-accent hover:underline">
                    {actor.parent.name}
                  </Link>
                </p>
              )}
              {actor.children.length > 0 && (
                <p>
                  Includes:{" "}
                  {actor.children.map((c, i) => (
                    <span key={c.id}>
                      {i > 0 && ", "}
                      <Link href={`/actor/${encodeURIComponent(c.id)}`} className="text-accent hover:underline">
                        {c.name}
                      </Link>
                    </span>
                  ))}
                </p>
              )}
            </div>
          ) : (
            <EmptyState title="No parent or subordinate units recorded" />
          )}
        </Section>
      )}

      {actor.kind === "unit" && (actor.equipment.length > 0 || actor.commanders.length > 0) && (
        <Section title="Equipment and commanders" testId="actor-military">
          {actor.commanders.length > 0 && <p className="text-sm text-ink-dim">Commanders: {actor.commanders.map((c) => `${c.rank ? `${c.rank} ` : ""}${c.name}`).join(", ")}</p>}
          {actor.equipment.length > 0 && <p className="mt-1 text-sm text-ink-dim">Equipment: {actor.equipment.map((e) => e.name).join(", ")}</p>}
        </Section>
      )}

      <Section title="Provenance" testId="actor-provenance">
        <p className="text-xs text-ink-dim">
          {actor.provenance.sourceName ?? "Source not recorded"}
          {actor.provenance.sourceUrl && (
            <>
              {" · "}
              <a href={actor.provenance.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                original record
              </a>
            </>
          )}
          {actor.provenance.lastUpdatedAt && (
            <>
              {" · updated "}
              <RelativeTime iso={actor.provenance.lastUpdatedAt} />
            </>
          )}
        </p>
      </Section>
    </main>
  );
}
