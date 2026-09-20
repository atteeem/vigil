import type { HazardProvider } from "./types";
import { usgsEarthquakes } from "./providers/usgs-earthquakes";
import { nasaFirms } from "./providers/firms-thermal";
import { eonetWildfires, eonetVolcanoes } from "./providers/eonet";
import { usgsVolcanoes } from "./providers/usgs-volcanoes";
import { nwsAlerts } from "./providers/nws-alerts";
import { gdacs } from "./providers/gdacs";

// One entry per structured provider. A Source of type "structured" names its provider in `platform`
// and may override the URL with `feedUrl` (tests point it at local fixtures).
export const HAZARD_PROVIDERS: Record<string, HazardProvider> = Object.fromEntries(
  [usgsEarthquakes, nasaFirms, eonetWildfires, eonetVolcanoes, usgsVolcanoes, nwsAlerts, gdacs].map((p) => [p.key, p]),
);

export function getHazardProvider(key: string | null | undefined): HazardProvider {
  const p = key ? HAZARD_PROVIDERS[key] : undefined;
  if (!p) throw new Error(`No structured-data provider registered for "${key ?? ""}"`);
  return p;
}
