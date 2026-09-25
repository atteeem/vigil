import { notFound } from "next/navigation";
import { RecordRecent } from "@/components/discovery/record-recent";
import type { Metadata } from "next";
import { getPublicCommander } from "@/lib/public/entities";
import { EmptyState } from "@/components/public/data-states";
import { EntityEventList, EntityLink, EntitySection, ProvenanceLine } from "@/components/entities/entity-sections";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const c = await getPublicCommander(id);
  return { title: c ? `${c.name} — Vigil` : "Commander — Vigil" };
}

/** Commander page: role/rank, appointment history and events — only what is sourced. No location, health,
 * operational status or intentions are stated. */
export default async function CommanderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getPublicCommander(id);
  if (!c) notFound();
  return (
    <main className="mx-auto max-w-3xl px-4 pb-28 pt-24 sm:px-6 sm:pt-32" data-testid="commander-page">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">Commander</p>
      <h1 className="mt-1 text-2xl font-semibold text-ink" data-testid="commander-name">
        {c.name}
      </h1>
      <RecordRecent type="commander" entityKey={c.id} title={c.name} kind="Commander" href={`/commander/${encodeURIComponent(c.id)}`} />
      <p className="mt-1 text-xs text-ink-dim" data-testid="commander-overview">
        {c.rank ?? "Rank not recorded"}
        {" · "}
        {c.currentUnit ? (
          <>
            Current assignment per source: <EntityLink href={c.currentUnit.href}>{c.currentUnit.name}</EntityLink>
          </>
        ) : (
          "No current assignment recorded"
        )}
      </p>
      <p className="mt-1 text-[11px] text-ink-faint" data-testid="commander-last-sourced">
        {c.lastSourcedText}
      </p>

      <EntitySection title="Also known as" testId="commander-aliases">
        {c.aliases.length > 0 ? (
          <ul className="text-sm text-ink-dim">
            {c.aliases.map((a) => (
              <li key={a.alias}>
                {a.alias} <span className="text-[11px] text-ink-faint">({a.typeLabel})</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No aliases recorded" />
        )}
      </EntitySection>

      <EntitySection title="Appointment history" testId="commander-appointments" note="Each appointment is kept; a new one closes the previous rather than replacing it.">
        {c.appointments.length > 0 ? (
          <ul className="space-y-2 text-sm text-ink-dim">
            {c.appointments.map((a, i) => (
              <li key={i} data-testid="commander-appointment">
                <EntityLink href={a.unit.href}>{a.unit.name}</EntityLink>{" "}
                <span className="text-[11px] text-ink-faint">
                  · {a.role ?? "role not recorded"} · {a.current ? "current per source" : `ended ${a.endDate?.slice(0, 10) ?? "on an unknown date"}`}
                  {a.startDate ? ` · from ${a.startDate.slice(0, 10)}` : " · start date not recorded"}
                </span>
                <div>
                  <ProvenanceLine provenance={a.provenance} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No appointments recorded" />
        )}
      </EntitySection>

      <EntitySection title="Related events" testId="commander-events">
        <EntityEventList events={c.events} emptyTitle="No published events name this commander yet" />
      </EntitySection>

      <EntitySection title="Provenance" testId="commander-provenance">
        <ProvenanceLine provenance={c.provenance} />
      </EntitySection>
    </main>
  );
}
