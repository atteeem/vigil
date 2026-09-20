import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getPublicEntity } from "@/lib/public/entities";
import { EmptyState } from "@/components/public/data-states";
import { EntityEventList, EntityLink, EntitySection, FreshnessText, ProvenanceLine, TACTICAL_NOTE } from "@/components/entities/entity-sections";
import { getCountryByCode } from "@/lib/reference/countries";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const unit = await getPublicEntity(id);
  return { title: unit ? `${unit.name} — Vigil` : "Unit — Vigil" };
}

/** Military unit / formation page: designation, place in the hierarchy, commanders, equipment, recent events and
 * sources. Reference knowledge only — no positions, no current deployment. */
export default async function UnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const unit = await getPublicEntity(id);
  if (!unit) notFound();
  if (!unit.isUnit) redirect(`/actor/${encodeURIComponent(unit.id)}`);
  const country = unit.country ? getCountryByCode(unit.country) : null;

  return (
    <main className="mx-auto max-w-3xl px-4 pb-28 pt-24 sm:px-6 sm:pt-32" data-testid="unit-page">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">Military unit / formation</p>
      <h1 className="mt-1 text-2xl font-semibold text-ink" data-testid="unit-name">
        {unit.name}
      </h1>
      {unit.nativeName && <p className="text-sm text-ink-dim">{unit.nativeName}</p>}
      <p className="mt-1 text-xs text-ink-dim" data-testid="unit-overview-line">
        {[unit.unitType, unit.branch, country ? `${country.flag} ${country.name}` : unit.country, unit.status ? `Status: ${unit.status}` : "Status not recorded"].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-1 text-xs text-ink-dim" data-testid="unit-organization">
        {unit.organization ? (
          <>
            Belongs to <EntityLink href={unit.organization.href}>{unit.organization.name}</EntityLink>
          </>
        ) : (
          "Higher organisation not recorded"
        )}
      </p>
      <p className="mt-2 text-xs text-ink-faint" data-testid="unit-last-observed">
        {unit.lastObservedText}
      </p>
      <p className="mt-1 text-[11px] text-ink-faint">{TACTICAL_NOTE}</p>

      <EntitySection title="Designations and aliases" testId="unit-aliases">
        {unit.aliases.length > 0 ? (
          <ul className="space-y-1 text-sm text-ink-dim">
            {unit.aliases.map((a) => (
              <li key={a.alias}>
                {a.alias} <span className="text-[11px] text-ink-faint">({a.typeLabel})</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No alternate designations recorded" />
        )}
      </EntitySection>

      <EntitySection title="Parent formation and structure" testId="unit-hierarchy">
        {unit.parent ? (
          <p className="text-sm text-ink-dim">
            Parent formation: <EntityLink href={unit.parent.href}>{unit.parent.name}</EntityLink>
            <span className="block">
              <ProvenanceLine provenance={unit.parent.provenance} />
            </span>
          </p>
        ) : (
          <EmptyState title="No parent formation recorded" testId="unit-no-parent" />
        )}
        {unit.parentHistory.length > 1 && (
          <ul className="mt-3 space-y-1 text-xs text-ink-faint" data-testid="unit-parent-history">
            <li className="font-semibold uppercase tracking-wide">Parent history</li>
            {unit.parentHistory.map((h, i) => (
              <li key={i}>
                {h.parent ? h.parent.name : "No parent"} {h.current ? "(current)" : `(until ${h.validTo?.slice(0, 10) ?? "unknown date"})`}
                {h.validFrom && ` · from ${h.validFrom.slice(0, 10)}`}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3" data-testid="unit-subordinates">
          {unit.subordinates.length > 0 ? (
            <p className="text-sm text-ink-dim">
              Subordinate units:{" "}
              {unit.subordinates.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ", "}
                  <EntityLink href={c.href}>{c.name}</EntityLink>
                </span>
              ))}
            </p>
          ) : (
            <p className="text-xs text-ink-faint">No subordinate units recorded.</p>
          )}
        </div>
      </EntitySection>

      <EntitySection title="Conflicts" testId="unit-conflicts">
        {unit.conflicts.length > 0 ? (
          <ul className="space-y-1.5 text-sm">
            {unit.conflicts.map((c) => (
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

      <EntitySection title="Commanders" testId="unit-commanders" note="As sourced. Appointments are kept as history; nothing is said about where a commander is or what they intend.">
        {unit.commanders.length > 0 ? (
          <ul className="space-y-2 text-sm text-ink-dim">
            {unit.commanders.map((c, i) => (
              <li key={`${c.commander.id}-${i}`} data-testid="unit-commander">
                <EntityLink href={c.commander.href}>{[c.rank, c.commander.name].filter(Boolean).join(" ")}</EntityLink>{" "}
                <span className="text-[11px] text-ink-faint">
                  · {c.role ?? "role not recorded"} · {c.current ? "current per source" : `former (until ${c.endDate?.slice(0, 10) ?? "unknown"})`}
                  {c.startDate && ` · from ${c.startDate.slice(0, 10)}`}
                </span>
                <div>
                  <ProvenanceLine provenance={c.provenance} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No commander recorded" testId="unit-no-commander" />
        )}
      </EntitySection>

      <EntitySection title="Equipment (known operator)" testId="unit-equipment" note="Sourced statements that this unit fields an equipment type — not inventory counts and not sightings in any event.">
        {unit.equipment.length > 0 ? (
          <ul className="space-y-2 text-sm text-ink-dim">
            {unit.equipment.map((e) => (
              <li key={e.equipment.id} data-testid="unit-equipment-item">
                <EntityLink href={e.equipment.href}>{e.equipment.name}</EntityLink> <span className="text-[11px] text-ink-faint">{e.category ? `· ${e.category}` : ""}</span>
                <div>
                  <ProvenanceLine provenance={e.provenance} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No equipment recorded" testId="unit-no-equipment" />
        )}
      </EntitySection>

      <EntitySection title="Recent events" testId="unit-events">
        <EntityEventList events={unit.events} />
      </EntitySection>

      <EntitySection title="Provenance" testId="unit-provenance">
        <p className="text-xs">
          <ProvenanceLine provenance={unit.provenance} />
        </p>
      </EntitySection>
    </main>
  );
}
