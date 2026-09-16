import type { ImpactComponent } from "@/lib/types";
import { DIMENSION_LABEL } from "@/lib/data/impact";
import { exposureLabel } from "@/lib/utils/exposure";

export function ImpactBreakdown({ component }: { component: ImpactComponent }) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">{DIMENSION_LABEL[component.dimension]}</p>
        <p className="text-sm font-semibold tabular-nums text-ink">
          {component.value} <span className="text-xs font-normal text-ink-faint">/ 100 · {exposureLabel(component.value)}</span>
        </p>
      </div>
      <div className="mt-2 space-y-1.5">
        {component.drivers.map((d) => (
          <div key={d.label} className="flex items-center justify-between text-xs">
            <span className="text-ink-dim" title={d.description}>{d.label}</span>
            <span className="font-medium text-ink">+{d.contribution}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
