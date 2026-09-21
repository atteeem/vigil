// Country reference used to locate a country for impact scoring and the country pickers. It is a thin view
// of the canonical registry (lib/countries/registry.ts): every country, not a hand-picked few. It is
// reference data, not conflict intelligence.
import type { Country } from "@/lib/types";
import { COUNTRY_RECORDS, getCountryRecord, type CountryRecord } from "@/lib/countries/registry";

const toCountry = (c: CountryRecord): Country => ({ code: c.code, name: c.name, region: c.region, lat: c.lat, lng: c.lng, population: c.population, flag: c.flag });

export const COUNTRIES: Country[] = COUNTRY_RECORDS.map(toCountry);

export function getCountryByCode(code: string): Country | undefined {
  const c = getCountryRecord(code);
  return c ? toCountry(c) : undefined;
}
