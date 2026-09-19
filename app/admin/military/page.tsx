"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Shield, Wrench, UserRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  MilitaryUnitDTO,
  MilitaryEquipmentDTO,
  CommanderDTO,
  CommanderAppointmentDTO,
  MilitaryUnitEquipmentLinkDTO,
} from "@/lib/types/db";

// MilitaryLand Phase 1 (spec "Add a simple admin/reference view sufficient
// to inspect: units, equipment, commanders, relationships, provenance. No
// major public UI redesign yet.") — a single tabbed inspector, read-focused
// (entities are populated via ingestion's automated entity extraction, not
// manually authored here) rather than a full CRUD form set, matching the
// "simple" scope of a Phase 1 reference layer.

type Tab = "units" | "equipment" | "commanders";

function ProvenanceBadge({ sourceName, sourceUrl }: { sourceName: string | null; sourceUrl: string | null }) {
  if (!sourceUrl) return <span className="text-xs text-ink-faint">No source recorded</span>;
  return (
    <a
      href={sourceUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
    >
      <ExternalLink className="h-3 w-3" />
      {sourceName || "Source"}
    </a>
  );
}

function UnitDetail({ unit }: { unit: MilitaryUnitDTO }) {
  const { data: links = [] } = useQuery<MilitaryUnitEquipmentLinkDTO[]>({
    queryKey: ["admin", "military-units", unit.id, "equipment"],
    queryFn: async () => (await fetch(`/api/admin/military-units/${unit.id}`)).json(),
  });
  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-faint">Name</div>
        <div className="text-ink">{unit.name}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-faint">Branch</div>
          <div className="text-ink-dim">{unit.branch ?? "—"}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-faint">Type</div>
          <div className="text-ink-dim">{unit.unitType ?? "—"}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-faint">Parent formation</div>
          <div className="text-ink-dim">{unit.parentUnitName ?? "—"}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-faint">Status</div>
          <div className="text-ink-dim">{unit.status ?? "—"}</div>
        </div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-faint">Equipment</div>
        {links.length === 0 ? (
          <div className="text-ink-faint">None linked yet.</div>
        ) : (
          <ul className="mt-1 space-y-1">
            {links.map((l) => (
              <li key={l.id} className="flex items-center justify-between">
                <span className="text-ink-dim">{l.equipmentName}</span>
                <ProvenanceBadge sourceName={l.sourceName} sourceUrl={l.sourceUrl} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-faint">Provenance</div>
        <ProvenanceBadge sourceName={unit.sourceName} sourceUrl={unit.sourceUrl} />
        <div className="mt-1 text-xs text-ink-faint">Last updated {new Date(unit.lastUpdatedAt).toLocaleString()}</div>
      </div>
    </div>
  );
}

function CommanderDetail({ commander }: { commander: CommanderDTO }) {
  const { data: appointments = [] } = useQuery<CommanderAppointmentDTO[]>({
    queryKey: ["admin", "commanders", commander.id, "appointments"],
    queryFn: async () => (await fetch(`/api/admin/commanders/${commander.id}`)).json(),
  });
  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-faint">Name</div>
        <div className="text-ink">
          {commander.rank ? `${commander.rank} ` : ""}
          {commander.name}
        </div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-faint">Current unit</div>
        <div className="text-ink-dim">{commander.currentUnitName ?? "—"}</div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-faint">Appointment history</div>
        {appointments.length === 0 ? (
          <div className="text-ink-faint">None recorded.</div>
        ) : (
          <ul className="mt-1 space-y-2">
            {appointments.map((a) => (
              <li key={a.id} className="rounded-lg border border-border/60 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-ink-dim">
                    {a.role ?? "commander"} · {a.unitName}
                  </span>
                  <ProvenanceBadge sourceName={a.sourceName} sourceUrl={a.sourceUrl} />
                </div>
                <div className="mt-0.5 text-xs text-ink-faint">
                  {a.startDate ? new Date(a.startDate).toLocaleDateString() : "unknown start"} –{" "}
                  {a.endDate ? new Date(a.endDate).toLocaleDateString() : "present"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-faint">Provenance</div>
        <ProvenanceBadge sourceName={commander.sourceName} sourceUrl={commander.sourceUrl} />
      </div>
    </div>
  );
}

function EquipmentDetail({ equipment }: { equipment: MilitaryEquipmentDTO }) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-faint">Name</div>
        <div className="text-ink">{equipment.name}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-faint">Category</div>
          <div className="text-ink-dim">{equipment.category ?? "—"}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-faint">Country of origin</div>
          <div className="text-ink-dim">{equipment.countryOfOrigin ?? "—"}</div>
        </div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-faint">Provenance</div>
        <ProvenanceBadge sourceName={equipment.sourceName} sourceUrl={equipment.sourceUrl} />
      </div>
    </div>
  );
}

export default function AdminMilitaryPage() {
  const [tab, setTab] = useState<Tab>("units");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: units = [], isLoading: unitsLoading } = useQuery<MilitaryUnitDTO[]>({
    queryKey: ["admin", "military-units"],
    queryFn: async () => (await fetch("/api/admin/military-units")).json(),
  });
  const { data: equipment = [], isLoading: equipmentLoading } = useQuery<MilitaryEquipmentDTO[]>({
    queryKey: ["admin", "military-equipment"],
    queryFn: async () => (await fetch("/api/admin/military-equipment")).json(),
  });
  const { data: commanders = [], isLoading: commandersLoading } = useQuery<CommanderDTO[]>({
    queryKey: ["admin", "commanders"],
    queryFn: async () => (await fetch("/api/admin/commanders")).json(),
  });

  const tabs: { id: Tab; label: string; icon: typeof Shield; count: number }[] = [
    { id: "units", label: "Units", icon: Shield, count: units.length },
    { id: "equipment", label: "Equipment", icon: Wrench, count: equipment.length },
    { id: "commanders", label: "Commanders", icon: UserRound, count: commanders.length },
  ];

  function selectTab(t: Tab) {
    setTab(t);
    setSelectedId(null);
  }

  const selectedUnit = tab === "units" ? units.find((u) => u.id === selectedId) : undefined;
  const selectedEquipment = tab === "equipment" ? equipment.find((e) => e.id === selectedId) : undefined;
  const selectedCommander = tab === "commanders" ? commanders.find((c) => c.id === selectedId) : undefined;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">Military Reference</h1>
        <p className="text-xs text-ink-faint">
          Sourced strategic reference data (MilitaryLand.net, CC BY-SA 4.0) — not live tactical tracking.
        </p>
      </div>

      <div className="mb-4 flex items-center gap-1 rounded-full border border-border bg-surface/60 p-1 w-fit">
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            onClick={() => selectTab(id)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              tab === id ? "bg-ink text-bg" : "text-ink-dim hover:text-ink",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label} <span className="text-xs opacity-70">{count}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_360px]">
        <Card className="overflow-x-auto">
          {tab === "units" && (
            <table className="w-full text-left text-sm" data-testid="military-units-table">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Branch</th>
                  <th className="px-4 py-3">Parent</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {unitsLoading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-ink-faint">
                      Loading…
                    </td>
                  </tr>
                )}
                {!unitsLoading && units.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-ink-faint">
                      No units yet — they&rsquo;re created automatically as MilitaryLand articles are ingested.
                    </td>
                  </tr>
                )}
                {units.map((u) => (
                  <tr
                    key={u.id}
                    data-testid={`military-unit-row-${u.id}`}
                    onClick={() => setSelectedId(u.id)}
                    className={cn(
                      "cursor-pointer border-b border-border/60 hover:bg-white/5",
                      selectedId === u.id && "bg-white/5",
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-ink">{u.name}</td>
                    <td className="px-4 py-3 text-ink-dim">{u.branch ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-dim">{u.parentUnitName ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-dim">{u.status ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "equipment" && (
            <table className="w-full text-left text-sm" data-testid="military-equipment-table">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Origin</th>
                </tr>
              </thead>
              <tbody>
                {equipmentLoading && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-ink-faint">
                      Loading…
                    </td>
                  </tr>
                )}
                {!equipmentLoading && equipment.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-ink-faint">
                      No equipment yet.
                    </td>
                  </tr>
                )}
                {equipment.map((e) => (
                  <tr
                    key={e.id}
                    data-testid={`military-equipment-row-${e.id}`}
                    onClick={() => setSelectedId(e.id)}
                    className={cn(
                      "cursor-pointer border-b border-border/60 hover:bg-white/5",
                      selectedId === e.id && "bg-white/5",
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-ink">{e.name}</td>
                    <td className="px-4 py-3 text-ink-dim">{e.category ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-dim">{e.countryOfOrigin ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "commanders" && (
            <table className="w-full text-left text-sm" data-testid="commanders-table">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Rank</th>
                  <th className="px-4 py-3">Current unit</th>
                </tr>
              </thead>
              <tbody>
                {commandersLoading && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-ink-faint">
                      Loading…
                    </td>
                  </tr>
                )}
                {!commandersLoading && commanders.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-ink-faint">
                      No commanders yet.
                    </td>
                  </tr>
                )}
                {commanders.map((c) => (
                  <tr
                    key={c.id}
                    data-testid={`commander-row-${c.id}`}
                    onClick={() => setSelectedId(c.id)}
                    className={cn(
                      "cursor-pointer border-b border-border/60 hover:bg-white/5",
                      selectedId === c.id && "bg-white/5",
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-ink">{c.name}</td>
                    <td className="px-4 py-3 text-ink-dim">{c.rank ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-dim">{c.currentUnitName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="p-4">
          {selectedUnit && <UnitDetail unit={selectedUnit} />}
          {selectedEquipment && <EquipmentDetail equipment={selectedEquipment} />}
          {selectedCommander && <CommanderDetail commander={selectedCommander} />}
          {!selectedUnit && !selectedEquipment && !selectedCommander && (
            <p className="text-sm text-ink-faint">Select a row to inspect its relationships and provenance.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
