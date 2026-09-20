import { test, expect } from "@playwright/test";
import { getCountryByCode, computeCountryExposure, computeImpact } from "@/lib/data";
import { MOCK_CONFLICTS } from "@/lib/dev-fixtures/mock-conflicts";
import { aggregateExposure, combineDamped } from "@/lib/scoring/exposure";

// Global Exposure aggregation (lib/scoring/exposure.ts + lib/data/impact.ts).
// Regression: Ukraine showed a headline of 65 while Russia–Ukraine's own impact
// was 100 — the headline was a weighted average of five dimension blends, so an
// active full-scale war inside the country was diluted by unrelated dimensions.

const country = (code: string) => getCountryByCode(code)!;
const conflictBySlug = (slug: string) => MOCK_CONFLICTS.find((c) => c.slug === slug)!;

test.describe("Country exposure hard floors", () => {
  test("Ukraine: active full-scale war inside the country -> overall exposure 100 (not diluted)", () => {
    const exposure = computeCountryExposure(country("UA"), MOCK_CONFLICTS);
    expect(exposure.score).toBe(100);
    expect(computeImpact(country("UA"), conflictBySlug("russia-ukraine")).score).toBe(100);
    // Security strongly reflects the own-country war.
    expect(exposure.components.find((c) => c.dimension === "security")!.value).toBe(100);
  });

  test("Finland (borders Russia, a party to the war): Russia–Ukraine impact and headline are at least 75", () => {
    const impact = computeImpact(country("FI"), conflictBySlug("russia-ukraine"));
    expect(impact.score).toBeGreaterThanOrEqual(75);
    expect(impact.hardFloor).toBe("bordering_war");
    const exposure = computeCountryExposure(country("FI"), MOCK_CONFLICTS);
    expect(exposure.score).toBeGreaterThanOrEqual(75);
    expect(exposure.components.find((c) => c.dimension === "security")!.value).toBeGreaterThanOrEqual(75);
  });

  test("Poland (borders Ukraine, attacker/defender irrelevant): Russia–Ukraine impact >= 75 and headline >= 75", () => {
    const impact = computeImpact(country("PL"), conflictBySlug("russia-ukraine"));
    expect(impact.score).toBeGreaterThanOrEqual(75);
    expect(impact.hardFloor).toBe("bordering_war");
    expect(computeCountryExposure(country("PL"), MOCK_CONFLICTS).score).toBeGreaterThanOrEqual(75);
    expect(computeCountryExposure(country("PL"), MOCK_CONFLICTS).components.find((c) => c.dimension === "security")!.value).toBeGreaterThanOrEqual(75);
  });

  test("Germany is neither a party to the war nor bordering one: no hard floor", () => {
    const impact = computeImpact(country("DE"), conflictBySlug("russia-ukraine"));
    expect(impact.hardFloor).toBeNull();
    expect(impact.score).toBeLessThan(75);
  });

  test("a distant country with no direct exposure scores clearly lower than a bordering one", () => {
    const distant = computeCountryExposure(country("JP"), MOCK_CONFLICTS).score;
    const bordering = computeCountryExposure(country("PL"), MOCK_CONFLICTS).score;
    expect(distant).toBeLessThan(75);
    expect(distant).toBeLessThan(bordering);
  });

  test("results are deterministic (no random jitter): the same country always gets identical numbers", () => {
    expect(computeCountryExposure(country("FI"), MOCK_CONFLICTS)).toEqual(computeCountryExposure(country("FI"), MOCK_CONFLICTS));
    expect(computeImpact(country("FI"), conflictBySlug("syria"))).toEqual(computeImpact(country("FI"), conflictBySlug("syria")));
  });
});

test.describe("aggregateExposure", () => {
  const low = (n: number) => Array.from({ length: n }, (_, i) => ({ conflictId: `low-${i}`, conflictName: `Low ${i}`, impactScore: 15 + (i % 5), hardFloor: null }));
  const own = { conflictId: "own", conflictName: "Own war", impactScore: 100, hardFloor: "own_country_war" as const };
  const border = { conflictId: "border", conflictName: "Border war", impactScore: 75, hardFloor: "bordering_war" as const };

  test("own-country war -> 100 whatever else is monitored", () => {
    expect(aggregateExposure([own]).score).toBe(100);
    expect(aggregateExposure([...low(40), own]).score).toBe(100);
    expect(aggregateExposure([own, ...low(40)]).floor).toBe("own_country_war");
  });

  test("bordering war -> at least 75, and unrelated low-impact conflicts cannot reduce it", () => {
    const alone = aggregateExposure([border]).score;
    expect(alone).toBeGreaterThanOrEqual(75);
    for (const n of [1, 5, 25, 100]) {
      const withMany = aggregateExposure([border, ...low(n)]).score;
      expect(withMany).toBeGreaterThanOrEqual(75);
      expect(withMany).toBeGreaterThanOrEqual(alone);
    }
  });

  test("a floor is enforced on the aggregate even if the conflict's own impact number were lower", () => {
    expect(aggregateExposure([{ conflictId: "b", conflictName: "B", impactScore: 60, hardFloor: "bordering_war" }]).score).toBe(75);
  });

  test("averaging cannot dilute: adding conflicts never lowers the score", () => {
    let previous = 0;
    const base = { conflictId: "m", conflictName: "Moderate", impactScore: 55, hardFloor: null };
    for (const n of [0, 1, 3, 10, 30]) {
      const score = aggregateExposure([base, ...low(n)]).score;
      expect(score).toBeGreaterThanOrEqual(previous);
      previous = score;
    }
  });

  test("without an own-country war the score never reaches 100", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ conflictId: `h-${i}`, conflictName: `H ${i}`, impactScore: 98, hardFloor: null }));
    expect(aggregateExposure(many).score).toBeLessThanOrEqual(99);
  });

  test("combination is explainable: reasons name the lead conflict and floor, contributions cover the conflicts", () => {
    const result = aggregateExposure([border, ...low(3)]);
    expect(result.leadConflictId).toBe("border");
    expect(result.reasons.join(" ")).toContain("Border war");
    expect(result.contributions[0]!.conflictName).toBe("Border war");
    expect(result.contributions).toHaveLength(4);
  });

  test("combineDamped: empty -> 0, single value -> itself, monotone, 100 stays 100", () => {
    expect(combineDamped([])).toBe(0);
    expect(combineDamped([42])).toBe(42);
    expect(combineDamped([42, 30])).toBeGreaterThanOrEqual(42);
    expect(combineDamped([100, 5])).toBe(100);
  });
});

test.describe("Exposure dimensions are honest about what they are", () => {
  test("only Security is computed; energy/trade/finance/food are labelled estimated", () => {
    const { components } = computeCountryExposure(country("FI"), MOCK_CONFLICTS);
    const basis = Object.fromEntries(components.map((c) => [c.dimension, c.basis]));
    expect(basis).toEqual({ security: "computed", energy: "estimated", trade: "estimated", finance: "estimated", food_supply: "estimated" });
  });
});

test.describe("For You page", () => {
  test.use({ isMobile: false });

  test("Ukraine selected: Global Exposure reads 100 and the estimated dimensions say so", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("vigil-preferences", JSON.stringify({ state: { baseCountryCode: "UA" }, version: 1 }));
    });
    await page.goto("/for-you");
    await expect(page.getByText("Your Global Exposure")).toBeVisible();
    await expect(page.getByTestId("exposure-basis-energy")).toContainText("Estimated");
    await expect(page.getByTestId("exposure-basis-security")).toContainText("Computed");
    // No fabricated sparkline: cards carry no chart.
    await expect(page.locator("[data-testid^=exposure-card-] svg.recharts-surface")).toHaveCount(0);
  });
});

test.describe("For You headline, rendered", () => {
  test.use({ isMobile: false });

  for (const [code, atLeast] of [["UA", 100], ["FI", 75]] as const) {
    test(`${code} selected: the headline Global Exposure shown on the page is >= ${atLeast}`, async ({ page }) => {
      await page.addInitScript((c) => {
        localStorage.setItem("vigil-preferences", JSON.stringify({ state: { baseCountryCode: c }, version: 1 }));
      }, code);
      await page.goto("/for-you");
      await expect(page.getByText("Your Global Exposure")).toBeVisible();
      // CountUp animates; wait for the final number, then read it.
      const headline = page.locator("p:has-text('Your Global Exposure') + div span.tabular-nums").first();
      await expect.poll(async () => Number((await headline.textContent())?.trim()), { timeout: 10_000 }).toBeGreaterThanOrEqual(atLeast);
    });
  }
});
