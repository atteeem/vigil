// Records the territorial-data providers that were evaluated but NOT integrated, with the reason, in the dataset registry
// (visible in the admin coverage view, never listed publicly because none of them has published geometry). Evaluated
// 2026-09-21; see docs/TERRITORIAL_DATASETS.md for the full assessment.
//   BASE_URL=http://localhost:3000 node scripts/register-territorial-candidates.mjs
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const api = async (path, init) => {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
};
const conflicts = await api("/api/admin/conflicts");
const id = (slug) => conflicts.find((c) => c.slug === slug)?.id ?? null;

const CANDIDATES = [
  {
    slug: "isw-ctp-ukraine-control-of-terrain",
    name: "Ukraine: Assessed control of terrain (ISW / Critical Threats)",
    conflictId: id("russia-ukraine"),
    countryCodes: ["UA", "RU"],
    datasetType: "TERRITORIAL_CONTROL",
    provider: "Institute for the Study of War / Critical Threats Project (ArcGIS Online)",
    sourceUrl: "https://www.arcgis.com/home/item.html?id=9f04944a2fe84edab9da31750c2b15eb",
    license: "Not licensed for reuse: the item description states the geodata is the exclusive intellectual property of ISW",
    coverageDescription: "Daily assessed control of terrain in Ukraine (high quality, frequent).",
    geometryAvailability: "blocked",
    reviewStatus: "blocked",
    notes: "Reference candidate only. Viewing is public but no reuse licence is granted, so the geometry is NOT copied. Ask ISW for a data licence to integrate.",
  },
  {
    slug: "deepstatemap-ukraine-occupied-territory",
    name: "Ukraine: Occupied territory (DeepStateMap)",
    conflictId: id("russia-ukraine"),
    countryCodes: ["UA"],
    datasetType: "TERRITORIAL_CONTROL",
    provider: "DeepStateMap.live (community GitHub mirrors)",
    sourceUrl: "https://deepstatemap.live",
    license: "Unclear: mirrors (e.g. cyterat/deepstate-map-data, GPL-3.0 on the repository) state no permission from DeepState for the underlying geometry",
    coverageDescription: "Daily occupied-area multipolygons, widely used.",
    geometryAvailability: "blocked",
    reviewStatus: "rejected",
    notes: "Rejected: the only machine-readable copies are third-party scrapes whose reuse rights for DeepState's geometry are not stated. Reconsider with a direct licence from DeepState.",
  },
  {
    slug: "ocha-opt-oslo-areas-abc",
    name: "West Bank: Oslo Agreement Areas A/B/C (OCHA oPt)",
    conflictId: id("israel-palestine"),
    countryCodes: ["PS", "IL"],
    datasetType: "TERRITORIAL_CONTROL",
    provider: "OCHA oPt / Palestinian Authority Ministry of Planning (HDX)",
    sourceUrl: "https://data.humdata.org/dataset/state-of-palestine-other-0-0-0-0-0",
    license: "HDX 'Other' (legacy HR.info terms of use)",
    coverageDescription: "Administrative and security arrangement zones under the Oslo II Accord; dataset date 2004.",
    validFrom: "2004-01-01T00:00:00.000Z",
    geometryAvailability: "none",
    reviewStatus: "candidate",
    notes: "Not integrated: a 2004 legal arrangement, not current de-facto control, no Gaza coverage, and a non-standard licence. It could be shown later only if labelled as the Oslo arrangement, not as control.",
  },
  {
    slug: "hdx-ukraine-affected-areas-donetska-luhanska",
    name: "Ukraine: Affected areas, Donetska and Luhanska (HDX)",
    conflictId: id("russia-ukraine"),
    countryCodes: ["UA"],
    datasetType: "TERRITORIAL_CONTROL",
    provider: "OCHA Ukraine (HDX)",
    sourceUrl: "https://data.humdata.org/dataset/ukraine-affected-areas-donetska-and-luhanska-oblasts",
    license: "Creative Commons Attribution (CC BY)",
    coverageDescription: "Government / non-government controlled areas in Donetska and Luhanska, 2021 vintage.",
    validFrom: "2021-08-13T00:00:00.000Z",
    geometryAvailability: "none",
    reviewStatus: "rejected",
    notes: "Rejected: pre-2022 contact-line areas, superseded by the current war; would misrepresent today's control.",
  },
  {
    slug: "hdx-myanmar-areas-of-control-raster",
    name: "Myanmar: Areas of control, March 2025 (HDX, raster)",
    conflictId: id("myanmar"),
    countryCodes: ["MM"],
    datasetType: "TERRITORIAL_CONTROL",
    provider: "British Red Cross Maps Team (HDX), adapted from a Wikipedia map",
    sourceUrl: "https://data.humdata.org/dataset/myanmar-areas-of-control",
    license: "Public Domain / No restrictions (CC0)",
    coverageDescription: "A georeferenced IMAGE (GeoTIFF) of areas of control on 8 March 2025.",
    validFrom: "2025-03-08T00:00:00.000Z",
    geometryAvailability: "none",
    reviewStatus: "rejected",
    notes: "Rejected: a raster adapted from a Wikipedia image with no accuracy guarantee (the provider's own caveat); there is no vector geometry and it is a single point in time.",
  },
  {
    slug: "mexico-ocg-presence-state-panel",
    name: "Mexico: Criminal-group presence by state, 2007-2015 (Sobrino et al.)",
    conflictId: id("mexico-cartel"),
    countryCodes: ["MX"],
    datasetType: "PRESENCE",
    provider: "Signoret, Alcocer, Farfan-Mendez, Sobrino (Harvard Dataverse)",
    sourceUrl: "https://doi.org/10.7910/DVN/N0KGCZ",
    license: "CC0 1.0",
    attribution: "Signoret, Alcocer, Farfan-Mendez & Sobrino, Mapping Criminal Organizations in Mexico: State Panel 2007-2015 (Harvard Dataverse, CC0)",
    coverageDescription: "State-by-month presence of organised criminal groups. PRESENCE only; not control.",
    validFrom: "2007-01-01T00:00:00.000Z",
    validTo: "2015-12-31T00:00:00.000Z",
    geometryAvailability: "none",
    reviewStatus: "candidate",
    notes: "Reputable, open (CC0), and correctly PRESENCE data, but it is a table that ends in 2015 and needs state boundaries joined to it; too old to present as current. Candidate for a future presence layer if a newer panel is published.",
  },
];

for (const c of CANDIDATES) {
  const row = await api("/api/admin/territorial-datasets", { method: "POST", body: JSON.stringify(c) });
  console.log(`${row.reviewStatus.padEnd(9)} ${row.slug}`);
}
