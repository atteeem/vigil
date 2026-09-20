"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Shield, Wrench, UserRound, MapPin, Flag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { IntelligenceAudit } from "@/components/admin/intelligence-audit";
import { cn } from "@/lib/utils";
import type {
  MilitaryUnitDTO,
  MilitaryEquipmentDTO,
  CommanderDTO,
  CommanderAppointmentDTO,
  MilitaryUnitEquipmentLinkDTO,
  MilitaryUnitEventLinkDTO,
  AreaOfOperationDTO,
  TerritorialChangeCandidateDTO,
} from "@/lib/types/db";

// MilitaryLand Phase 1 (spec "Add a simple admin/reference view sufficient
// to inspect: units, equipment, commanders, relationships, provenance. No
// major public UI redesign yet.") — a single tabbed inspector, read-focused
// (entities are populated via ingestion's automated entity extraction, not
// manually authored here) rather than a full CRUD form set, matching the
// "simple" scope of a Phase 1 reference layer.

type Tab = "audit" | "units" | "equipment" | "commanders" | "areas" | "candidates";

const PRECISION_LABEL: Record<string, string> = {
  exact: "Exact",
  approximate: "Approximate",
  area_level: "Area-level",
  unknown: "Unknown precision",
};

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
  const { data: unitEvents = [] } = useQuery<MilitaryUnitEventLinkDTO[]>({
    queryKey: ["admin", "military-units", unit.id, "events"],
    queryFn: async () => (await fetch(`/api/admin/military-units/${unit.id}/events`)).json(),
  });
  const { data: unitAreas = [] } = useQuery<AreaOfOperationDTO[]>({
    queryKey: ["admin", "areas-of-operation", unit.id],
    queryFn: async () => (await fetch(`/api/admin/areas-of-operation?unitId=${unit.id}`)).json(),
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
        <div className="text-xs uppercase tracking-wide text-ink-faint">Linked events</div>
        {unitEvents.length === 0 ? (
          <div className="text-ink-faint">None yet.</div>
        ) : (
          <ul className="mt-1 space-y-1">
            {unitEvents.map((e) => (
              <li key={e.id} className="text-ink-dim">
                {e.eventTitle}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-faint">Areas of operation</div>
        {unitAreas.length === 0 ? (
          <div className="text-ink-faint">None recorded.</div>
        ) : (
          <ul className="mt-1 space-y-1">
            {unitAreas.map((a) => (
              <li key={a.id} className="text-ink-dim">
                {a.name ?? "Unnamed area"} · {PRECISION_LABEL[a.precision]}
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

function AreaDetail({ area }: { area: AreaOfOperationDTO }) {
  return (
    <div className="space-y-3 text-sm" data-testid="aoo-detail">
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-faint">Area of operation</div>
        <div className="text-ink">{area.name ?? "Unnamed area"}</div>
        <div className="text-ink-dim">{area.unitName}</div>
      </div>
      <p className="rounded-lg border border-border/60 p-2 text-xs text-ink-faint">
        Where this group has demonstrated operational activity. This is not territorial control and never feeds the
        Territorial Control layer.
      </p>
      {area.description && <p className="text-ink-dim">{area.description}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-faint">Precision</div>
          <div className="text-ink-dim">{PRECISION_LABEL[area.precision]}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-faint">As of</div>
          <div className="text-ink-dim">{area.asOfDate ? new Date(area.asOfDate).toLocaleDateString() : "—"}</div>
        </div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-faint">Provenance</div>
        <ProvenanceBadge sourceName={area.sourceName} sourceUrl={area.sourceUrl} />
      </div>
    </div>
  );
}

function CandidateDetail({ candidate }: { candidate: TerritorialChangeCandidateDTO }) {
  const queryClient = useQueryClient();
  async function review(status: "reviewed" | "dismissed") {
    await fetch(`/api/admin/territorial-change-candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    queryClient.invalidateQueries({ queryKey: ["admin", "territorial-change-candidates"] });
  }
  return (
    <div className="space-y-3 text-sm" data-testid="candidate-detail">
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-faint">Reported change</div>
        <div className="text-ink">{candidate.description}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-faint">Gained by</div>
          <div className="text-ink-dim">{candidate.claimedActorName ?? "—"}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-faint">Lost by</div>
          <div className="text-ink-dim">{candidate.previousActorName ?? "—"}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-faint">Location</div>
          <div className="text-ink-dim">{candidate.locationName ?? "—"}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-faint">Precision</div>
          <div className="text-ink-dim">{PRECISION_LABEL[candidate.precision]}</div>
        </div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-faint">Provenance</div>
        <ProvenanceBadge sourceName={candidate.sourceName} sourceUrl={candidate.sourceUrl} />
      </div>
      <p className="rounded-lg border border-border/60 p-2 text-xs text-ink-faint">
        A candidate only flags a report for review. Reviewing or dismissing it never changes Territorial Control
        polygons — create or supersede a territory separately if you accept the claim.
      </p>
      {candidate.status === "pending" ? (
        <div className="flex gap-2">
          <button onClick={() => review("reviewed")} className="rounded-lg border border-border px-3 py-1 text-xs text-ink hover:bg-white/5">
            Mark reviewed
          </button>
          <button onClick={() => review("dismissed")} className="rounded-lg border border-border px-3 py-1 text-xs text-ink-dim hover:bg-white/5">
            Dismiss
          </button>
        </div>
      ) : (
        <div className="text-xs text-ink-faint">Status: {candidate.status}</div>
      )}
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

  const { data: areas = [] } = useQuery<AreaOfOperationDTO[]>({
    queryKey: ["admin", "areas-of-operation"],
    queryFn: async () => (await fetch("/api/admin/areas-of-operation")).json(),
  });
  const { data: candidates = [] } = useQuery<TerritorialChangeCandidateDTO[]>({
    queryKey: ["admin", "territorial-change-candidates"],
    queryFn: async () => (await fetch("/api/admin/territorial-change-candidates")).json(),
  });

  const tabs: { id: Tab; label: string; icon: typeof Shield; count: number }[] = [
    { id: "audit", label: "Intelligence audit", icon: Shield, count: 0 },
    { id: "units", label: "Units", icon: Shield, count: units.length },
    { id: "equipment", label: "Equipment", icon: Wrench, count: equipment.length },
    { id: "commanders", label: "Commanders", icon: UserRound, count: commanders.length },
    { id: "areas", label: "Areas of Operation", icon: MapPin, count: areas.length },
    { id: "candidates", label: "Territory Candidates", icon: Flag, count: candidates.length },
  ];

  function selectTab(t: Tab) {
    setTab(t);
    setSelectedId(null);
  }

  const selectedUnit = tab === "units" ? units.find((u) => u.id === selectedId) : undefined;
  const selectedEquipment = tab === "equipment" ? equipment.find((e) => e.id === selectedId) : undefined;
  const selectedCommander = tab === "commanders" ? commanders.find((c) => c.id === selectedId) : undefined;
  const selectedArea = tab === "areas" ? areas.find((a) => a.id === selectedId) : undefined;
  const selectedCandidate = tab === "candidates" ? candidates.find((c) => c.id === selectedId) : undefined;

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
            {label} {id !== "audit" && <span className="text-xs opacity-70">{count}</span>}
          </button>
        ))}
      </div>

      {tab === "audit" && <IntelligenceAudit />}
      <div className={cn("grid gap-4 sm:grid-cols-[1fr_360px]", tab === "audit" && "hidden")}>
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
          {tab === "areas" && (
            <table className="w-full text-left text-sm" data-testid="areas-table">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3">Area</th>
                  <th className="px-4 py-3">Group</th>
                  <th className="px-4 py-3">Precision</th>
                </tr>
              </thead>
              <tbody>
                {areas.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-ink-faint">
                      No areas of operation recorded.
                    </td>
                  </tr>
                )}
                {areas.map((a) => (
                  <tr
                    key={a.id}
                    data-testid={`aoo-row-${a.id}`}
                    onClick={() => setSelectedId(a.id)}
                    className={cn("cursor-pointer border-b border-border/60 hover:bg-white/5", selectedId === a.id && "bg-white/5")}
                  >
                    <td className="px-4 py-3 font-medium text-ink">{a.name ?? "Unnamed area"}</td>
                    <td className="px-4 py-3 text-ink-dim">{a.unitName}</td>
                    <td className="px-4 py-3 text-ink-dim">{PRECISION_LABEL[a.precision]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "candidates" && (
            <table className="w-full text-left text-sm" data-testid="candidates-table">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Gained by</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {candidates.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-ink-faint">
                      No territorial-change candidates.
                    </td>
                  </tr>
                )}
                {candidates.map((c) => (
                  <tr
                    key={c.id}
                    data-testid={`candidate-row-${c.id}`}
                    onClick={() => setSelectedId(c.id)}
                    className={cn("cursor-pointer border-b border-border/60 hover:bg-white/5", selectedId === c.id && "bg-white/5")}
                  >
                    <td className="px-4 py-3 font-medium text-ink">{c.locationName ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-dim">{c.claimedActorName ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-dim">{c.status}</td>
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
          {selectedArea && <AreaDetail area={selectedArea} />}
          {selectedCandidate && <CandidateDetail candidate={selectedCandidate} />}
          {!selectedUnit && !selectedEquipment && !selectedCommander && !selectedArea && !selectedCandidate && (
            <p className="text-sm text-ink-faint">Select a row to inspect its relationships and provenance.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
