import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validateTerritorialGeometry } from "@/lib/territory/geometry";
import { TERRITORIAL_DATASET_TYPES } from "@/lib/territory/dataset-types";

// The territorial dataset registry (data/territorial-datasets.json) and the one imported dataset (ACAPS Yemen). The
// registry records what EXISTS and whether it may be reused; only an entry with a geometry file is imported, and only as
// unpublished drafts that a human must approve. Nothing here is hard-coded in React.

interface Entry { slug: string; datasetType: string; geometryFile?: string; reviewStatus?: string; geometryAvailability?: string; license?: string; notes?: string }
const registry = JSON.parse(readFileSync("data/territorial-datasets.json", "utf8")) as { datasets: Entry[] };
const acaps = JSON.parse(readFileSync("data/territorial/acaps-yemen-areas-of-control.json", "utf8")) as {
  source: { license: string; datasetUrl: string; attribution: string };
  versions: { snapshot: string; validFrom: string; resourceUrl: string; actors: { code: string; name: string; districtCount: number; geometry: unknown }[] }[];
};

test.describe("registry file", () => {
  test("every entry has a known dataset type, a unique slug and a licence statement", () => {
    const slugs = registry.datasets.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const d of registry.datasets) {
      expect(TERRITORIAL_DATASET_TYPES as readonly string[]).toContain(d.datasetType);
      expect(d.license, d.slug).toBeTruthy();
    }
  });

  test("blocked and candidate sources carry no geometry; only the licensed import has a geometry file", () => {
    for (const d of registry.datasets) {
      if (d.reviewStatus === "blocked" || d.reviewStatus === "candidate") expect(d.geometryFile, d.slug).toBeUndefined();
    }
    expect(registry.datasets.filter((d) => d.geometryFile).map((d) => d.slug)).toEqual(["acaps-yemen-areas-of-control"]);
  });

  test("activity-based sources (cartels) are PRESENCE, never control", () => {
    for (const d of registry.datasets.filter((x) => /mexico|cartel|dto|ocved/i.test(x.slug))) expect(d.datasetType).toBe("PRESENCE");
  });
});

test.describe("imported ACAPS Yemen geometry", () => {
  test("keeps its provenance and licence, and is valid, antimeridian-safe territorial geometry for every actor and version", () => {
    expect(acaps.source.license).toBe("CC BY 4.0");
    expect(acaps.source.datasetUrl).toBe("https://data.humdata.org/dataset/yemen-areas-of-control");
    expect(acaps.versions.length).toBeGreaterThan(0);
    for (const v of acaps.versions) {
      expect(v.resourceUrl).toMatch(/^https:\/\/data\.humdata\.org\//);
      expect(v.actors.map((a) => a.code).sort()).toEqual(["DFA", "IRG"]);
      for (const a of v.actors) expect(validateTerritorialGeometry(a.geometry), `${v.snapshot} ${a.code}`).toEqual({ valid: true, errors: [] });
    }
  });
});

test.describe("seeded registry (test DB)", () => {
  test("the import is waiting for review: not offered publicly until a human approves it; candidates are never offered", async ({ request }) => {
    const available = (await (await request.get("/api/territorial-control/datasets")).json()).datasets as { name: string }[];
    expect(available.find((d) => /ACAPS|DeepState|ISW|Wikipedia|OCVED|Coscia/.test(d.name))).toBeUndefined();
    const coverage = (await (await request.get("/api/admin/territorial-datasets")).json()) as { rows: { slug: string; state: string; datasets: { slug: string | null; reviewStatus: string; draftVersions: number; publishedVersions: number; datasetType: string }[] }[] };
    const yemen = coverage.rows.find((r) => r.slug === "yemen-red-sea")!;
    const imported = yemen.datasets.find((d) => d.slug === "acaps-yemen-areas-of-control")!;
    expect(imported.reviewStatus).toBe("pending_review");
    expect(imported.publishedVersions).toBe(0);
    expect(imported.draftVersions).toBe(acaps.versions.reduce((n, v) => n + v.actors.length, 0));
    const ukraine = coverage.rows.find((r) => r.slug === "russia-ukraine")!;
    for (const slug of ["isw-ukraine-assessed-control", "deepstatemap-ukraine"]) expect(ukraine.datasets.find((d) => d.slug === slug)).toMatchObject({ reviewStatus: "blocked", publishedVersions: 0, draftVersions: 0 });
    const mexico = coverage.rows.find((r) => r.slug === "mexico-cartel")!;
    for (const d of mexico.datasets) expect(d.datasetType).toBe("PRESENCE");
  });
});
