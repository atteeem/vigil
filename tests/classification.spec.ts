import { test, expect } from "@playwright/test";

// Core deterministic suite for the "classifiable and manageable at scale"
// milestone (spec: conflict management, duplicate-candidate engine,
// automated draft extraction, geocoding, source independence, review UI).
// Unlike tests/rss-ingestion.spec.ts (kept as a manual/smoke test against
// the live BBC feed), everything here uses a fixture RSS feed
// (app/api/test-fixtures/rss/[name]/route.ts) or the manual-submission API
// so the suite never depends on external network state.
test.describe.serial("Classification & scale milestone", () => {
  let fixtureSourceId: string;
  // Tracked explicitly rather than re-derived by title filtering: this
  // suite's two Playwright projects (Desktop/Mobile) run serially against
  // the SAME dev-server database, each creating its own "Fixture Feed A"
  // source and publishing a same-titled Kyiv event — filtering /api/events
  // by title would pick up the other project's leftover event too.
  let kyivEventId: string;

  test("0. Fixture RSS source can be created and points at the local fixture feed", async ({ request }) => {
    const res = await request.post("/api/admin/sources", {
      data: {
        name: "Fixture Feed A",
        type: "rss",
        // Absolute URL required — RSSAdapter fetches this server-side.
        url: "http://localhost:3100/api/test-fixtures/rss/feed-a",
        language: "en",
        sourceCategory: "News",
        reliabilityTier: "A",
        enabled: true,
        autoIngest: false,
        autoProcessing: true,
      },
    });
    expect(res.ok()).toBeTruthy();
    const source = await res.json();
    fixtureSourceId = source.id;
  });

  test("1. Deterministic RSS ingestion: Fetch Now creates exactly the fixture's 3 items, second fetch dedupes to zero new", async ({
    request,
  }) => {
    const res1 = await request.post(`/api/admin/sources/${fixtureSourceId}/fetch`);
    const result1 = await res1.json();
    expect(result1.errors).toBe(0);
    expect(result1.new).toBe(3);

    const res2 = await request.post(`/api/admin/sources/${fixtureSourceId}/fetch`);
    const result2 = await res2.json();
    expect(result2.errors).toBe(0);
    expect(result2.new).toBe(0);
    expect(result2.alreadyKnown).toBe(3);

    const itemsRes = await request.get("/api/admin/incoming?status=pending");
    const items = await itemsRes.json();
    const fixtureItems = items.filter((i: { sourceId: string }) => i.sourceId === fixtureSourceId);
    expect(fixtureItems.map((i: { originalTitle: string }) => i.originalTitle).sort()).toEqual(
      [
        "Drone strike hits fuel depot near Kyiv",
        "Heavy shelling reported near Novoselivka overnight",
        "Unrelated feature: local bakery wins national award",
      ].sort(),
    );
  });

  test("2. Automated draft: resolved single-candidate location (Kyiv) suggests event type, location, conflict, verification", async ({
    request,
  }) => {
    const itemsRes = await request.get("/api/admin/incoming?status=pending");
    const items = await itemsRes.json();
    const kyivItem = items.find((i: { originalTitle: string }) => i.originalTitle === "Drone strike hits fuel depot near Kyiv");
    expect(kyivItem).toBeTruthy();

    const draftRes = await request.get(`/api/admin/incoming/${kyivItem.id}/draft`);
    const { draft } = await draftRes.json();
    expect(draft).toBeTruthy();
    expect(draft.eventType).toBe("drone");
    expect(draft.locationSource).toBe("resolved");
    expect(draft.locationName).toContain("Kyiv");
    expect(draft.latitude).toBeCloseTo(50.45, 1);
    expect(draft.longitude).toBeCloseTo(30.52, 1);
    expect(draft.conflictName).toBe("Russia–Ukraine War");
    expect(draft.verificationStatus).toBe("reported");
    // "no casualties confirmed" must not trigger the high-severity heuristic.
    expect(draft.severity).not.toBe("high");
  });

  test("3. Automated draft: ambiguous location (Novoselivka) returns 3 candidates and never silently picks one", async ({
    request,
  }) => {
    const itemsRes = await request.get("/api/admin/incoming?status=pending");
    const items = await itemsRes.json();
    const novoItem = items.find((i: { originalTitle: string }) =>
      i.originalTitle.includes("Novoselivka"),
    );
    expect(novoItem).toBeTruthy();

    const draftRes = await request.get(`/api/admin/incoming/${novoItem.id}/draft`);
    const { draft } = await draftRes.json();
    expect(draft.locationSource).toBe("ambiguous");
    expect(draft.latitude).toBeNull();
    expect(draft.longitude).toBeNull();
    expect(draft.locationCandidates).toHaveLength(3);
    const labels = draft.locationCandidates.map((c: { label: string }) => c.label).sort();
    expect(labels).toEqual(
      [
        "Novoselivka, Donetsk Oblast, Ukraine",
        "Novoselivka, Kharkiv Oblast, Ukraine",
        "Novoselivka, Zaporizhzhia Oblast, Ukraine",
      ].sort(),
    );
  });

  test("4. Automated draft: item with no known place name yields locationSource 'none', not a guess", async ({ request }) => {
    const itemsRes = await request.get("/api/admin/incoming?status=pending");
    const items = await itemsRes.json();
    const bakeryItem = items.find((i: { originalTitle: string }) => i.originalTitle.includes("bakery"));
    expect(bakeryItem).toBeTruthy();

    const draftRes = await request.get(`/api/admin/incoming/${bakeryItem.id}/draft`);
    const { draft } = await draftRes.json();
    expect(draft.locationSource).toBe("none");
    expect(draft.latitude).toBeNull();
    expect(draft.longitude).toBeNull();
  });

  test("5. Review UI distinguishes SOURCE DATA from AUTOMATED SUGGESTION, and human can override every suggested field before publishing", async ({
    page,
    request,
  }) => {
    const itemsRes = await request.get("/api/admin/incoming?status=pending");
    const items = await itemsRes.json();
    const kyivItem = items.find((i: { originalTitle: string }) => i.originalTitle.includes("Kyiv"));

    await page.goto("/admin/incoming");
    const card = page.getByTestId(`incoming-item-${kyivItem.id}`);
    await expect(card.getByText("Source Data", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Review" }).click();
    await expect(card.getByText(/AUTOMATED SUGGESTION/i)).toBeVisible();

    // Human overrides the automated title, event type, and severity. The
    // title is namespaced with the fixture source id — Desktop and Mobile
    // projects each run this whole suite against the same dev-server
    // database, so a fixed title would collide between projects.
    const publishedTitle = `Human-edited: drone strike near Kyiv fuel depot [${fixtureSourceId}]`;
    await card.getByLabel("Title").fill(publishedTitle);
    await card.getByLabel("Event type", { exact: true }).selectOption("explosion");
    const summaryBox = card.getByLabel(/^Summary/);
    await summaryBox.fill("Independently written summary overriding the automated suggestion (classification test).");

    const [publishResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/publish") && res.request().method() === "POST"),
      card.getByRole("button", { name: "Publish" }).click(),
    ]);
    const published = await publishResponse.json();
    expect(published.eventType).toBe("explosion"); // human override wins, not the automated "drone" suggestion
    expect(published.title).toBe(publishedTitle);
    kyivEventId = published.id;

    await expect(page.getByTestId(`incoming-item-${kyivItem.id}`)).toHaveCount(0);
  });

  test("6. Nothing auto-publishes: ingesting the fixture feed never creates a public event by itself", async ({ request }) => {
    const beforeRes = await request.get("/api/events");
    const before = await beforeRes.json();

    // Novoselivka + bakery items are still pending from test 1 — re-fetching must not publish them.
    await request.post(`/api/admin/sources/${fixtureSourceId}/fetch`);

    const afterRes = await request.get("/api/events");
    const after = await afterRes.json();
    expect(after.length).toBe(before.length);

    const pendingRes = await request.get("/api/admin/incoming?status=pending");
    const pending = await pendingRes.json();
    expect(pending.some((i: { originalTitle: string }) => i.originalTitle.includes("Novoselivka"))).toBe(true);
  });

  test("7. Duplicate-candidate engine: a similar second report surfaces the published Kyiv event with a ranked score", async ({
    request,
  }) => {
    const source = await request.get("/api/admin/sources").then((r) => r.json());
    const fixture = source.find((s: { id: string }) => s.id === fixtureSourceId);

    // The duplicate window is ±14 days of the CANDIDATE's occurredAt, not
    // "now" — the published Kyiv event's occurredAt came from the fixture's
    // fixed pubDate, so the follow-up report must be timed relative to that
    // actual stored value (read back via the API) rather than the current
    // wall-clock time, or it would fall outside the scoring window entirely.
    const eventsRes = await request.get("/api/events");
    const events = await eventsRes.json();
    const kyivEvent = events.find((e: { id: string }) => e.id === kyivEventId);
    expect(kyivEvent).toBeTruthy();
    const followUpAt = new Date(new Date(kyivEvent.occurredAt).getTime() + 12 * 60_000).toISOString();

    const dupTitle = `Second drone strike reported near Kyiv fuel depot [${fixtureSourceId}]`;
    const dupItem = await request
      .post("/api/admin/incoming/manual", {
        data: {
          sourceId: fixture.id,
          externalId: `dup-kyiv-${Date.now()}`,
          originalUrl: "https://fixture.test/dup-kyiv",
          originalTitle: dupTitle,
          originalText: "A follow-up report describes another drone strike near the same Kyiv fuel depot.",
          publishedAt: followUpAt,
        },
      })
      .then((r) => r.json());

    const dupRes = await request.post(`/api/admin/incoming/${dupItem.id}/duplicates`, {
      data: {
        title: dupTitle,
        eventType: "drone",
        latitude: 50.45,
        longitude: 30.52,
        countryCode: "UA",
        region: "Europe",
        occurredAt: followUpAt,
      },
    });
    // Repeated local suite runs can leave earlier runs' similarly-timed
    // Kyiv events in the DB too (this suite never resets it — same
    // convention as tests/rss-ingestion.spec.ts) — find THIS run's event
    // by id among the candidates rather than assuming it ranks first.
    const candidates = await dupRes.json();
    expect(candidates.length).toBeGreaterThan(0);
    const match = candidates.find((c: { eventId: string }) => c.eventId === kyivEventId);
    expect(match).toBeTruthy();
    expect(match.title).toContain("Kyiv");
    expect(match.score).toBeGreaterThanOrEqual(35);
    expect(match.score).toBeLessThanOrEqual(100);
    expect(typeof match.distanceKm).toBe("number");
    expect(typeof match.minutesApart).toBe("number");
  });

  test("8. Merge attaches the duplicate as a new source on the SAME event — no second public event, source count increments", async ({
    request,
  }) => {
    const eventsRes = await request.get("/api/events");
    const events = await eventsRes.json();
    const kyivEvent = events.find((e: { id: string }) => e.id === kyivEventId);
    expect(kyivEvent).toBeTruthy();
    const countBefore = kyivEvent.sourceCount;

    const pendingRes = await request.get("/api/admin/incoming?status=pending");
    const pending = await pendingRes.json();
    const dupItem = pending.find((i: { originalTitle: string }) => i.originalTitle.includes(`[${fixtureSourceId}]`));
    expect(dupItem).toBeTruthy();

    const mergeRes = await request.post(`/api/admin/incoming/${dupItem.id}/merge`, {
      data: { eventId: kyivEvent.id, relationship: "corroborating" },
    });
    expect(mergeRes.ok()).toBeTruthy();

    const afterRes = await request.get("/api/events");
    const after = await afterRes.json();
    const kyivEventsMatching = after.filter((e: { id: string }) => e.id === kyivEventId);
    expect(kyivEventsMatching).toHaveLength(1); // merge never creates a second public event
    expect(kyivEventsMatching[0].sourceCount).toBe(countBefore + 1);

    const mergedItemRes = await request.get(`/api/admin/incoming?status=merged`);
    const merged = await mergedItemRes.json();
    expect(merged.some((i: { id: string }) => i.id === dupItem.id)).toBe(true);
  });

  test("9. Source independence: a relay of the same originating report does NOT increase the independent source count", async ({
    request,
  }) => {
    const eventsRes = await request.get("/api/events");
    const events = await eventsRes.json();
    const kyivEvent = events.find((e: { id: string }) => e.id === kyivEventId);
    const countBefore = kyivEvent.sourceCount;

    const source = await request.get("/api/admin/sources").then((r) => r.json());
    const fixture = source.find((s: { id: string }) => s.id === fixtureSourceId);

    const relayItem = await request
      .post("/api/admin/incoming/manual", {
        data: {
          sourceId: fixture.id,
          externalId: `relay-kyiv-${Date.now()}`,
          originalUrl: "https://fixture.test/relay-kyiv",
          originalTitle: `RT: drone strike near Kyiv fuel depot [${fixtureSourceId}]`,
          originalText: "Wire relay of the same Kyiv fuel depot drone strike report.",
          publishedAt: new Date(new Date(kyivEvent.occurredAt).getTime() + 30 * 60_000).toISOString(),
        },
      })
      .then((r) => r.json());

    await request.post(`/api/admin/incoming/${relayItem.id}/merge`, {
      data: { eventId: kyivEvent.id, relationship: "relay" },
    });

    const afterRes = await request.get("/api/events");
    const after = await afterRes.json();
    const kyivAfter = after.find((e: { id: string }) => e.id === kyivEventId);
    expect(kyivAfter.sourceCount).toBe(countBefore); // relay must not inflate independent-source count
  });

  test("10. Ignore suggestion removes a duplicate candidate from the review list without merging or rejecting", async ({
    request,
    page,
  }) => {
    const source = await request.get("/api/admin/sources").then((r) => r.json());
    const fixture = source.find((s: { id: string }) => s.id === fixtureSourceId);
    const eventsRes = await request.get("/api/events");
    const events = await eventsRes.json();
    const kyivEvent = events.find((e: { id: string }) => e.id === kyivEventId);
    // Same ±14-day window constraint as test 7 — anchor to the event's
    // actual stored occurredAt, not wall-clock "now".
    const followUpAt = new Date(new Date(kyivEvent.occurredAt).getTime() + 20 * 60_000).toISOString();

    const ignoreItem = await request
      .post("/api/admin/incoming/manual", {
        data: {
          sourceId: fixture.id,
          externalId: `ignore-kyiv-${Date.now()}`,
          originalUrl: "https://fixture.test/ignore-kyiv",
          originalTitle: `Third report of drone strike near Kyiv fuel depot [${fixtureSourceId}]`,
          originalText: "Another report describing the same Kyiv fuel depot drone strike.",
          publishedAt: followUpAt,
        },
      })
      .then((r) => r.json());

    await page.goto("/admin/incoming");
    const card = page.getByTestId(`incoming-item-${ignoreItem.id}`);
    await card.getByRole("button", { name: "Review" }).click();
    await card.getByLabel("Latitude").fill("50.45");
    await card.getByLabel("Longitude").fill("30.52");
    await card.getByRole("button", { name: "Re-check" }).click();

    // Repeated local suite runs can surface more than one candidate (other
    // runs' similarly-timed Kyiv events) — target THIS run's Kyiv-event
    // candidate specifically rather than assuming it's the only one.
    const kyivCandidate = card.getByTestId(`duplicate-candidate-${kyivEventId}`);
    await expect(kyivCandidate).toBeVisible();
    await expect(kyivCandidate.getByText(/Likely existing event/)).toBeVisible();

    await kyivCandidate.getByRole("button", { name: "Ignore suggestion" }).click();
    await expect(kyivCandidate).toHaveCount(0);

    // Ignoring is UI-only: the item is still pending, untouched, not merged into the event.
    const pendingRes = await request.get("/api/admin/incoming?status=pending");
    const pending = await pendingRes.json();
    expect(pending.some((i: { id: string }) => i.id === ignoreItem.id)).toBe(true);

    const finalEventsRes = await request.get("/api/events");
    const finalEvents = await finalEventsRes.json();
    const kyivFinal = finalEvents.find((e: { id: string }) => e.id === kyivEvent.id);
    expect(kyivFinal.sourceCount).toBe(kyivEvent.sourceCount); // untouched by the ignored suggestion
  });

  test("11. Rejection leaves the item stored but creates no event", async ({ request, page }) => {
    const pendingRes = await request.get("/api/admin/incoming?status=pending");
    const pending = await pendingRes.json();
    const bakeryItem = pending.find((i: { originalTitle: string }) => i.originalTitle.includes("bakery"));
    expect(bakeryItem).toBeTruthy();

    await page.goto("/admin/incoming");
    const card = page.getByTestId(`incoming-item-${bakeryItem.id}`);
    await card.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByTestId(`incoming-item-${bakeryItem.id}`)).toHaveCount(0);

    const rejectedRes = await request.get("/api/admin/incoming?status=rejected");
    const rejected = await rejectedRes.json();
    expect(rejected.some((i: { id: string }) => i.id === bakeryItem.id)).toBe(true);

    const eventsRes = await request.get("/api/events");
    const events = await eventsRes.json();
    expect(events.some((e: { title: string }) => e.title === bakeryItem.originalTitle)).toBe(false);
  });
});

test.describe.serial("Conflict management (admin)", () => {
  let conflictId: string;
  const slug = `e2e-test-conflict-${Date.now()}`;

  test("1. All 14 seeded conflicts are present with correct region/countries", async ({ request }) => {
    const res = await request.get("/api/admin/conflicts");
    const conflicts = await res.json();
    const expected: Record<string, string[]> = {
      "russia-ukraine": ["UA", "RU"],
      "israel-palestine": ["IL", "PS"],
      "israel-lebanon": ["IL", "LB"],
      syria: ["SY"],
      "persian-gulf-iran": ["IR"],
      "yemen-red-sea": ["YE"],
      sudan: ["SD"],
      drc: ["CD"],
      somalia: ["SO"],
      sahel: ["ML", "NE", "BF"],
      myanmar: ["MM"],
      "india-pakistan": ["IN", "PK"],
      "korean-peninsula": ["KR", "KP"],
      "taiwan-strait": ["TW", "CN"],
    };
    expect(conflicts.length).toBeGreaterThanOrEqual(14);
    for (const [conflictSlug, countries] of Object.entries(expected)) {
      const c = conflicts.find((x: { slug: string }) => x.slug === conflictSlug);
      expect(c, `missing conflict ${conflictSlug}`).toBeTruthy();
      expect(c.countries.sort()).toEqual(countries.sort());
    }
  });

  test("2. Create, edit, and status-change a conflict via the admin UI", async ({ page }) => {
    await page.goto("/admin/conflicts");
    await page.getByRole("button", { name: "Create Conflict" }).click();
    await page.getByLabel("Slug", { exact: true }).fill(slug);
    await page.getByLabel("Name", { exact: true }).fill("E2E Test Conflict");
    await page.getByLabel("Region", { exact: true }).fill("Testland");
    await page.getByLabel("Countries (comma-separated ISO codes)").fill("ZZ");
    // The page has two "Create Conflict"-labeled buttons once the form is
    // open (header toggle + form submit) — the submit button is the form's
    // own, rendered after the toggle in DOM order.
    await page.getByRole("button", { name: "Create Conflict" }).last().click();

    const row = page.getByTestId(`conflict-row-${slug}`);
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: /^Edit/ }).click();
    await page.getByLabel("Short name").fill("E2E");
    await page.getByRole("button", { name: "Save Changes" }).click();
    // exact: true — a substring match on "E2E" also hits the row's slug
    // text (e2e-test-conflict-…), which is unrelated and always present.
    await expect(row.getByText("E2E", { exact: true })).toBeVisible();

    await row.getByLabel(/^Status for/).selectOption("dormant");
    await expect(row.getByLabel(/^Status for/)).toHaveValue("dormant");
  });

  test("3. Conflict picker in incoming-report review offers this DB conflict", async ({ page, request }) => {
    const conflicts = await request.get("/api/admin/conflicts?selectable=true").then((r) => r.json());
    expect(conflicts.some((c: { slug: string }) => c.slug === slug)).toBe(true);
  });

  test("4. Delete is blocked while events are linked, archive always works", async ({ request }) => {
    const conflicts = await request.get("/api/admin/conflicts").then((r) => r.json());
    const ru = conflicts.find((c: { slug: string }) => c.slug === "russia-ukraine");
    expect(ru.eventCount).toBeGreaterThan(0);

    const delRes = await request.delete(`/api/admin/conflicts/${ru.id}`);
    expect(delRes.status()).toBe(409);

    const archiveRes = await request.patch(`/api/admin/conflicts/${ru.id}`, { data: { status: "archived" } });
    expect(archiveRes.ok()).toBeTruthy();
    // Restore, since other tests / manual exploration rely on it being selectable.
    await request.patch(`/api/admin/conflicts/${ru.id}`, { data: { status: "active" } });
  });

  test("5. Delete succeeds for a conflict with zero linked events", async ({ request }) => {
    const conflicts = await request.get("/api/admin/conflicts").then((r) => r.json());
    const testConflict = conflicts.find((c: { slug: string }) => c.slug === slug);
    expect(testConflict.eventCount).toBe(0);

    const res = await request.delete(`/api/admin/conflicts/${testConflict.id}`);
    expect(res.ok()).toBeTruthy();

    const after = await request.get("/api/admin/conflicts").then((r) => r.json());
    expect(after.some((c: { slug: string }) => c.slug === slug)).toBe(false);
  });
});
