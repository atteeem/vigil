import { notFound } from "next/navigation";
import { RecordRecent } from "@/components/discovery/record-recent";
import type { Metadata } from "next";
import { getPublicEquipment } from "@/lib/public/entities";
import { EmptyState } from "@/components/public/data-states";
import { EntityEventList, EntityLink, EntitySection, ProvenanceLine } from "@/components/entities/entity-sections";
import { getCountryByCode } from "@/lib/reference/countries";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const e = await getPublicEquipment(id);
  return { title: e ? `${e.name} — Vigil` : "Equipment — Vigil" };
}

/** Equipment reference page. "Known operator" (a sourced statement that a unit fields this TYPE) and
 * "observed in an event" (a report names it there) are kept apart; no inventory quantity is ever shown. */
export default async function EquipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = await getPublicEquipment(id);
  if (!e) notFound();
  const origin = e.countryOfOrigin ? getCountryByCode(e.countryOfOrigin) : null;
  return (
    <main className="mx-auto max-w-3xl px-4 pb-28 pt-24 sm:px-6 sm:pt-32" data-testid="equipment-page">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">Equipment</p>
      <h1 className="mt-1 text-2xl font-semibold text-ink" data-testid="equipment-name">
        {e.name}
      </h1>
      <RecordRecent type="equipment" entityKey={e.id} title={e.name} kind="Equipment" href={`/equipment/${encodeURIComponent(e.id)}`} />
      <p className="mt-1 text-xs text-ink-dim" data-testid="equipment-overview">
        {e.category ?? "Category not recorded"}
        {" · "}
        {e.countryOfOrigin ? `Origin: ${origin?.name ?? e.countryOfOrigin}` : "Origin not recorded"}
      </p>

      <EntitySection title="Also known as" testId="equipment-aliases">
        {e.aliases.length > 0 ? (
          <ul className="text-sm text-ink-dim">
            {e.aliases.map((a) => (
              <li key={a.alias}>
                {a.alias} <span className="text-[11px] text-ink-faint">({a.typeLabel})</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No aliases recorded" />
        )}
      </EntitySection>

      <EntitySection title="Known operators" testId="equipment-operators" note="Units sourced as fielding this equipment type. This is not an inventory and not a statement about any particular event.">
        {e.knownOperators.length > 0 ? (
          <ul className="space-y-2 text-sm text-ink-dim">
            {e.knownOperators.map((o) => (
              <li key={o.unit.id} data-testid="equipment-operator">
                <EntityLink href={o.unit.href}>{o.unit.name}</EntityLink>
                <div>
                  <ProvenanceLine provenance={o.provenance} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No known operators recorded" />
        )}
      </EntitySection>

      <EntitySection title="Named in sourced events" testId="equipment-events" note="Events whose reports mention this equipment. Separate from being a known operator.">
        <EntityEventList events={e.observedInEvents} emptyTitle="No published events name this equipment yet" />
      </EntitySection>

      <EntitySection title="Provenance" testId="equipment-provenance">
        <ProvenanceLine provenance={e.provenance} />
      </EntitySection>
    </main>
  );
}
