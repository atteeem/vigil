import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getPublicEntity } from "@/lib/public/entities";
import { getPublicTerritoryActor } from "@/lib/public/actors";
import { EmptyState } from "@/components/public/data-states";
import { RelativeTime } from "@/components/ui/relative-time";
import { EntityEventList, EntityLink, EntitySection, FreshnessText, ProvenanceLine, TACTICAL_NOTE, TrustChip } from "@/components/entities/entity-sections";
import { getCountryByCode } from "@/lib/reference/countries";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }): Promise<Metadata> {
  const { ref } = await params;
  const entity = await getPublicEntity(ref);
  return { title: entity ? `${entity.name} — Vigil` : "Actor — Vigil" };
}

/** Actor / organisation page: overview, relationships, recent events, territorial role, military structure
 * and sources — all from stored, sourced records. Military units have their own page (/unit). */
export default async function ActorPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const entity = await getPublicEntity(ref);
  if (!entity) {
    const territoryActor = await getPublicTerritoryActor(ref);
    if (!territoryActor) notFound();
    return (
      <main className="mx-auto max-w-3xl px-4 pb-28 pt-24 sm:px-6 sm:pt-32" data-testid="actor-page">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">Territorial-control actor</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink" data-testid="actor-name">
          {territoryActor.name}
        </h1>
        <EntitySection title="Conflict" testId="actor-conflicts">
          <EntityLink href={`/conflict/${territoryActor.conflict.slug}`}>{territoryActor.conflict.name}</EntityLink>
        </EntitySection>
        <EntitySection title="Territorial control" testId="actor-territory">
          <p className="text-sm text-ink-dim">{territoryActor.areas > 0 ? `Currently recorded as controlling ${territoryActor.areas} published area${territoryActor.areas === 1 ? "" : "s"}.` : "No published territorial areas currently recorded."}</p>
        </EntitySection>
        <EntitySection title="More" testId="actor-more">
          <EmptyState title="No further knowledge recorded for this actor" detail="It appears only in territorial-control records so far." />
        </EntitySection>
      </main>
    );
  }
  if (entity.isUnit) redirect(`/unit/${encodeURIComponent(entity.id)}`);

  const country = entity.country ? getCountryByCode(entity.country) : null;
  return (
    <main className="mx-auto max-w-3xl px-4 pb-28 pt-24 sm:px-6 sm:pt-32" data-testid="actor-page">
      {/* OVERVIEW */}
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint" data-testid="actor-kind">
        {entity.entityTypeLabel}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-ink" data-testid="actor-name">
        {entity.name}
      </h1>
      {entity.nativeName && <p className="text-sm text-ink-dim">{entity.nativeName}</p>}
      <p className="mt-1 text-xs text-ink-dim" data-testid="actor-overview-line">
        {[country ? `${country.flag} ${country.name}` : entity.country, entity.status ? `Status: ${entity.status}` : "Status not recorded", entity.branch, entity.unitType].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-1 text-[11px] text-ink-faint" data-testid="actor-last-observed">
        {entity.lastObservedText}
      </p>
      <p className="mt-1 text-[11px] text-ink-faint">{TACTICAL_NOTE}</p>

      <EntitySection title="Also known as" testId="actor-aliases">
        {entity.aliases.length > 0 ? (
          <ul className="space-y-1 text-sm text-ink-dim">
            {entity.aliases.map((a) => (
              <li key={a.alias}>
                {a.alias} <span className="text-[11px] text-ink-faint">({a.typeLabel}{a.note ? ` · ${a.note}` : ""})</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No aliases recorded" />
        )}
      </EntitySection>

      <EntitySection title="Conflicts" testId="actor-conflicts">
        {entity.conflicts.length > 0 ? (
          <ul className="space-y-1.5 text-sm">
            {entity.conflicts.map((c) => (
              <li key={c.slug}>
                <EntityLink href={`/conflict/${c.slug}`}>{c.name}</EntityLink> <span className="text-[11px] text-ink-faint">· {c.role}</span>
                {c.provenance && (
                  <div>
                    <FreshnessText provenance={c.provenance} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Not linked to a conflict yet" />
        )}
      </EntitySection>

      {/* RELATIONSHIPS */}
      <EntitySection title="Structure and relationships" testId="actor-structure" note="Relationships are only shown when explicitly sourced; they are never inferred from two actors appearing in the same event.">
        {entity.parent || entity.subordinates.length > 0 || entity.relationships.length > 0 ? (
          <div className="space-y-3 text-sm text-ink-dim">
            {entity.parent && (
              <p>
                Part of <EntityLink href={entity.parent.href}>{entity.parent.name}</EntityLink>
                <span className="block">
                  <ProvenanceLine provenance={entity.parent.provenance} />
                </span>
              </p>
            )}
            {entity.subordinates.length > 0 && (
              <p data-testid="actor-subordinates">
                Includes:{" "}
                {entity.subordinates.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ", "}
                    <EntityLink href={c.href}>{c.name}</EntityLink>
                  </span>
                ))}
              </p>
            )}
            {entity.relationships.map((r) => (
              <p key={`${r.type}-${r.other.id}`} data-testid="actor-relationship">
                {r.label} <EntityLink href={r.other.href}>{r.other.name}</EntityLink>
                <span className="block">
                  <ProvenanceLine provenance={r.provenance} />
                </span>
              </p>
            ))}
          </div>
        ) : (
          <EmptyState title="No parent, subordinate or explicit alliance relationships recorded" />
        )}
      </EntitySection>

      {/* RECENT EVENTS */}
      <EntitySection title="Recent events" testId="actor-events">
        <EntityEventList events={entity.events} />
      </EntitySection>

      {/* TERRITORIAL ROLE */}
      <EntitySection title="Territorial role" testId="actor-territory">
        {entity.territory ? (
          <div className="space-y-2 text-sm text-ink-dim">
            <p>
              {entity.territory.areas > 0 ? `Currently recorded as controlling ${entity.territory.areas} published area${entity.territory.areas === 1 ? "" : "s"} in ` : "No published territorial areas currently recorded in "}
              <EntityLink href={`/conflict/${entity.territory.conflictSlug}`}>{entity.territory.conflictName}</EntityLink>
              {entity.territory.contested > 0 && ` · ${entity.territory.contested} contested or uncertain area${entity.territory.contested === 1 ? "" : "s"} in the conflict`}.
            </p>
            {entity.territory.changes.length > 0 && (
              <ul className="space-y-1 text-xs" data-testid="actor-territorial-changes">
                {entity.territory.changes.map((c) => (
                  <li key={c.id}>
                    <span className="text-ink-faint">{c.role === "claimed" ? "Claimed" : "Previously held"}: </span>
                    {c.description}
                    {c.observedAt && (
                      <span className="text-ink-faint">
                        {" · "}
                        <RelativeTime iso={c.observedAt} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <EmptyState title="No territorial-control role recorded" testId="actor-territory-empty" />
        )}
      </EntitySection>

      {/* MILITARY STRUCTURE */}
      <EntitySection title="Military structure" testId="actor-military">
        {entity.subordinates.length === 0 && entity.commanders.length === 0 && entity.equipment.length === 0 ? (
          <EmptyState title="No units, commanders or equipment recorded" />
        ) : (
          <div className="space-y-3 text-sm text-ink-dim">
            {entity.subordinates.length > 0 && <p>Known units: {entity.subordinates.map((c) => c.name).join(", ")}</p>}
            {entity.commanders.length > 0 && (
              <ul className="space-y-1" data-testid="actor-commanders">
                {entity.commanders.map((c) => (
                  <li key={c.commander.id + (c.startDate ?? "")}>
                    <EntityLink href={c.commander.href}>{[c.rank, c.commander.name].filter(Boolean).join(" ")}</EntityLink> <span className="text-[11px] text-ink-faint">· {c.role ?? "role not recorded"}{c.current ? "" : " (former)"}</span>
                    <div>
                      <FreshnessText provenance={c.provenance} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {entity.equipment.length > 0 && (
              <p data-testid="actor-equipment">
                Known equipment:{" "}
                {entity.equipment.map((e, i) => (
                  <span key={e.equipment.id}>
                    {i > 0 && ", "}
                    <EntityLink href={e.equipment.href}>{e.equipment.name}</EntityLink>
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
      </EntitySection>

      {/* SOURCES */}
      <EntitySection title="Provenance" testId="actor-provenance">
        <p className="text-xs text-ink-dim">
          <ProvenanceLine provenance={entity.provenance} />
        </p>
        {entity.sources.length > 1 && (
          <ul className="mt-2 space-y-1 text-[11px] text-ink-faint" data-testid="actor-sources">
            {entity.sources.map((s, i) => (
              <li key={`${s.label}-${i}`}>
                {s.label}: {s.name ?? "source not recorded"}{" "}
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    link
                  </a>
                ) : (
                  <span>Source unavailable</span>
                )}{" "}
                <TrustChip trust={s.trust} />
              </li>
            ))}
          </ul>
        )}
      </EntitySection>
      <Link href="/conflicts" className="mt-8 inline-block text-xs text-accent hover:underline">
        ← All conflicts
      </Link>
    </main>
  );
}
