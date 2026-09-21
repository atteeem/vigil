"use client";

import { LocationPicker } from "@/components/admin/location-picker";
import { ADMIN_REGIONS } from "@/lib/geocoding/admin-regions";
import { SCOPE_RULES } from "@/lib/geocoding/scope-rules";
import { LOCATION_SCOPES, LOCATION_SCOPE_LABEL, type DraftSuggestionDTO, type LocationScope } from "@/lib/types/db";
import { PRECISION_LABEL } from "@/lib/territory/location-precision";

export interface ScopeDraft {
  locationScope: LocationScope;
  locationPrecision: string;
  locationName: string;
  countryCode: string;
  region: string; // macro region ("Europe")
  adminRegion: string;
  city: string;
  latitude: string;
  longitude: string;
  locationEvidence: string;
}

const input = "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink";

/** Geographic scope and the fields it needs. Coordinates are mandatory only for an exact point; the map preview stays
 * for the scopes that can have a point, and its marker is labelled with what the point represents. */
export function LocationScopeFields({ draft, onChange, suggestion }: { draft: ScopeDraft; onChange: (patch: Partial<ScopeDraft>) => void; suggestion?: DraftSuggestionDTO | null }) {
  const rule = SCOPE_RULES[draft.locationScope];
  const showMap = rule.coordinates !== "none";

  function setScope(scope: LocationScope) {
    const r = SCOPE_RULES[scope];
    onChange({
      locationScope: scope,
      locationPrecision: r.precision === "exact" ? "exact" : r.precision,
      ...(r.coordinates === "none" ? { latitude: "", longitude: "" } : {}),
      ...(scope === "global" ? { countryCode: "", adminRegion: "", city: "" } : {}),
      ...(scope === "country" ? { adminRegion: "", city: "" } : {}),
      ...(scope === "region" ? { city: "" } : {}),
    });
  }

  function setAdminRegion(name: string) {
    const known = ADMIN_REGIONS.find((r) => r.name.toLowerCase() === name.trim().toLowerCase() && (!draft.countryCode || r.countryCode === draft.countryCode));
    onChange({ adminRegion: name, ...(draft.locationScope === "region" ? { latitude: known ? String(known.lat) : "", longitude: known ? String(known.lng) : "", ...(known && !draft.countryCode ? { countryCode: known.countryCode } : {}) } : {}) });
  }

  return (
    <div className="sm:col-span-2" data-testid="location-scope-fields">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="col-span-2 text-xs text-ink-faint sm:col-span-1">
          Geographic scope
          <select className={input} value={draft.locationScope} onChange={(e) => setScope(e.target.value as LocationScope)} data-testid="scope-select">
            {LOCATION_SCOPES.map((s) => (
              <option key={s} value={s}>
                {LOCATION_SCOPE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        {rule.country && (
          <label className="text-xs text-ink-faint">
            Country code <span className="text-high">*</span>
            <input className={input} value={draft.countryCode} onChange={(e) => onChange({ countryCode: e.target.value.toUpperCase() })} placeholder="e.g. UA" required />
          </label>
        )}
        {rule.adminRegion && (
          <label className="text-xs text-ink-faint">
            Region (oblast / province / state) <span className="text-high">*</span>
            <input className={input} value={draft.adminRegion} onChange={(e) => setAdminRegion(e.target.value)} placeholder="e.g. Zhytomyr Oblast" list="admin-regions" required />
          </label>
        )}
        {rule.city && (
          <label className="text-xs text-ink-faint">
            City <span className="text-high">*</span>
            <input className={input} value={draft.city} onChange={(e) => onChange({ city: e.target.value })} placeholder="e.g. Kharkiv" required />
          </label>
        )}
        <label className="text-xs text-ink-faint">
          Map region
          <input className={input} value={draft.region} onChange={(e) => onChange({ region: e.target.value })} placeholder="Europe / Middle East / …" />
        </label>
      </div>
      <datalist id="admin-regions">
        {ADMIN_REGIONS.map((r) => (
          <option key={r.name} value={r.name} />
        ))}
      </datalist>
      <p className="mt-1 text-xs text-ink-faint" data-testid="scope-hint">
        {rule.hint}
      </p>

      {showMap && (
        <div className="mt-2">
          <LocationPicker
            value={{ lat: draft.latitude, lng: draft.longitude, locationName: draft.locationName, countryCode: draft.countryCode, region: draft.region }}
            ambiguousCandidates={suggestion?.locationSource === "ambiguous" ? suggestion.locationCandidates : undefined}
            onChange={(patch) =>
              onChange({
                ...(patch.lat !== undefined ? { latitude: patch.lat } : {}),
                ...(patch.lng !== undefined ? { longitude: patch.lng } : {}),
                ...(patch.locationName !== undefined ? { locationName: patch.locationName, ...(draft.locationScope === "city" ? { city: patch.locationName } : {}) } : {}),
                ...(patch.countryCode !== undefined ? { countryCode: patch.countryCode } : {}),
                ...(patch.region !== undefined ? { region: patch.region } : {}),
              })
            }
          />
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-xs text-ink-faint">
              Latitude {rule.coordinates === "required" && <span className="text-high">*</span>}
              <input className={input} value={draft.latitude} onChange={(e) => onChange({ latitude: e.target.value })} placeholder={rule.coordinates === "required" ? "required" : "optional"} />
            </label>
            <label className="text-xs text-ink-faint">
              Longitude {rule.coordinates === "required" && <span className="text-high">*</span>}
              <input className={input} value={draft.longitude} onChange={(e) => onChange({ longitude: e.target.value })} placeholder={rule.coordinates === "required" ? "required" : "optional"} />
            </label>
            {draft.locationScope === "point" ? (
              <label className="text-xs text-ink-faint">
                Location precision
                <select className={input} value={draft.locationPrecision} onChange={(e) => onChange({ locationPrecision: e.target.value })} data-testid="location-precision-select">
                  <option value="exact">Exact</option>
                  <option value="approximate">Approximate</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
            ) : (
              <div className="text-xs text-ink-faint">
                Location precision
                <p className="mt-1 rounded-lg border border-border bg-card/50 px-3 py-2 text-sm text-ink" data-testid="location-precision-fixed">
                  {PRECISION_LABEL[rule.precision === "exact" ? "exact" : (rule.precision as keyof typeof PRECISION_LABEL)]}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
      {(draft.locationScope === "region" || draft.locationScope === "city") && (
        <p className="mt-1 rounded-lg border border-accent/30 bg-accent-dim/40 px-3 py-1.5 text-xs text-ink-dim" data-testid="scope-precision-note">
          Location precision: {draft.locationScope === "region" ? "Region" : "City"}. The marker shows the {draft.locationScope === "region" ? "region's centroid" : "city's coordinates"}, not the incident point.
        </p>
      )}
      {draft.locationEvidence && (
        <p className="mt-1 text-xs text-ink-faint" data-testid="scope-evidence">
          Evidence: {draft.locationEvidence}
        </p>
      )}
    </div>
  );
}
