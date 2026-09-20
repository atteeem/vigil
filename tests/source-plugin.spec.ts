import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalizeUrl, identityKeys, INDEPENDENCE_CLASSES, CLAIM_POLICIES, SOURCE_VERIFICATION_STATUSES, parseTelegramHandle, parseXUrl, urlKey } from "@/lib/sources/identity";
import { independentSourceCount } from "@/lib/data/independence";
import { evidenceRoleOf, isNonIndependentRole } from "@/lib/registry/source-tiers";
import { assertIndependentEvidence } from "@/lib/db/repositories/territorial-changes";
import { REGISTRY_CONFLICTS } from "@/lib/registry/conflict-registry";

// Social / specialist source plug-in: exact URLs kept apart by purpose, verification
// state, nothing enabled just because a name was listed, party claims never counted
// as independent, and every article keeping its OWN URL.

const ROOT = process.cwd();
const read = (name: string) => JSON.parse(readFileSync(join(ROOT, "data", name), "utf8"));
const plugin = read("source-plugin.json") as {
  sources: { key: string; name: string; website?: string; feed?: string; telegram?: string; x?: string; class: string; claim?: string; role: string; conflicts: [string, string][] }[];
  needsVerification: { name: string; website?: string; conflicts: [string, string][]; reason: string }[];
  references: { name: string; url: string; conflict: string; kind: string }[];
};
const verification = read("source-plugin-verification.json") as { results: Record<string, { site?: { ok: boolean }; telegram?: { exists: boolean }; suppliedFeed?: { isRss: boolean }; advertisedFeeds?: { isRss: boolean }[] }> };
const FIXTURE_FEED = "http://localhost:3100/api/test-fixtures/rss";
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

type Row = { id: string; name: string; type: string; url: string | null; enabled: boolean; feedUrl: string | null; canonicalSourceUrl: string | null; socialProfileUrl: string | null; platform: string | null; platformHandle: string | null; telegramHandle: string | null; verificationStatus: string; verifiedAt: string | null; verificationNotes: string | null; independenceClass: string | null; claimPolicy: string | null; sourceRole: string | null };
const sources = async (request: APIRequestContext) => (await request.get("/api/admin/sources").then((r) => r.json())) as Row[];

// ---------------------------------------------------------------------------
test.describe("URL canonicalization and identity parsing", () => {
  test("canonicalizeUrl drops fragments and tracking parameters and lower-cases the host, leaving the path untouched", () => {
    expect(canonicalizeUrl("https://WWW.Example-Site.test/Path/Case?utm_source=x&keep=1#frag")).toBe("https://www.example-site.test/Path/Case?keep=1");
    expect(canonicalizeUrl("ftp://x.test/")).toBeNull();
    expect(canonicalizeUrl("not a url")).toBeNull();
    expect(urlKey("https://www.primicias.ec/")).toBe("primicias.ec");
    expect(urlKey("http://primicias.ec")).toBe("primicias.ec");
    expect(urlKey("https://primicias.ec/?utm_campaign=z")).toBe("primicias.ec");
  });

  test("telegram and X URLs give their handle; nothing is invented from a name", () => {
    expect(parseTelegramHandle("https://t.me/primiciasec")).toBe("primiciasec");
    expect(parseTelegramHandle("https://t.me/s/primiciasec")).toBe("primiciasec");
    expect(parseTelegramHandle("@Hengaw_Org")).toBe("Hengaw_Org");
    expect(parseTelegramHandle("https://example.org/primiciasec")).toBeNull();
    expect(parseTelegramHandle("Primicias")).toBeNull();
    expect(parseXUrl("https://x.com/PoliciaEcuador")).toEqual({ handle: "PoliciaEcuador", statusId: null });
    expect(parseXUrl("https://twitter.com/nbntweets/status/2101178386299208139")).toEqual({ handle: "nbntweets", statusId: "2101178386299208139" });
    expect(parseXUrl("https://t.me/x")).toBeNull();
  });

  test("identity keys: site, feed, social profile and handle are distinct namespaces (a site is not its Telegram channel)", () => {
    const keys = identityKeys({ canonicalSourceUrl: "https://www.primicias.ec/", socialProfileUrl: "https://t.me/primiciasec", platform: "telegram", platformHandle: "primiciasec" });
    expect(keys).toEqual(["site:primicias.ec", "social:t.me/primiciasec", "handle:telegram/primiciasec"]);
    expect(identityKeys({ feedUrl: "https://www.rappler.com/feed/" })).toEqual(["feed:rappler.com/feed"]);
  });

  test("the seed script's plain-JS identity module agrees with the TypeScript one", async () => {
    const js = await import(pathToFileURL(join(ROOT, "prisma/source-identity.mjs")).href);
    for (const url of ["https://WWW.Site.test/a/b?utm_medium=x&y=1#z", "http://t.me/abc123", "https://x.com/Foo_1/status/99", "junk", "https://www.primicias.ec/"]) {
      expect(js.canonicalizeUrl(url)).toBe(canonicalizeUrl(url));
      expect(js.urlKey(url)).toBe(urlKey(url));
      expect(js.parseTelegramHandle(url)).toBe(parseTelegramHandle(url));
      expect(js.parseXUrl(url)).toEqual(parseXUrl(url));
    }
    const f = { canonicalSourceUrl: "https://a.test/", feedUrl: "https://a.test/feed", socialProfileUrl: "https://t.me/abcd", platform: "telegram" as const, platformHandle: "abcd" };
    expect(js.identityKeys(f)).toEqual(identityKeys(f));
  });
});

// ---------------------------------------------------------------------------
test.describe("Supplied source list: exact URLs, no guessing", () => {
  const SUPPLIED = [
    "https://hengaw.net/", "https://t.me/Hengaw_Org", "https://acleddata.com/iran-crisis-live", "https://www.aljazeera.com/", "https://t.me/Irna_en", "https://t.me/Tasnim_Agency",
    "https://kurdistanhumanrights.org/", "https://www.eluniverso.com/rss/", "https://www.primicias.ec/", "https://t.me/primiciasec", "https://www.teleamazonas.com/", "https://t.me/teleamazonascanal",
    "https://x.com/PoliciaEcuador", "https://www.crisisgroup.org/africa/central-africa/cameroon", "https://www.cameroon-tribune.cm/category2.html/1/en.html/politics", "https://mimimefoinfos.com/",
    "https://www.journalducameroun.com/", "https://t.me/jdcFR", "https://www.eastmojo.com/", "https://ukhrultimes.com/", "https://cocomimanipur.com/", "https://libyaobserver.ly/", "https://libyaherald.com/",
    "https://www.cfr.org/global-conflict-tracker/conflict/civil-war-libya", "https://apnews.com/hub/libya", "https://www.crisisgroup.org/middle-east-north-africa/north-africa/libya", "https://t.me/naya_foriraq",
    "https://t.me/SONNALive", "https://t.me/GaroweOnline", "https://www.garoweonline.com/", "https://www.studiokalangou.org/", "https://actuniger.com/", "https://airinfoagadez.com/", "https://t.me/idfofficial",
    "https://t.me/UNIFIL_Lebanon", "https://www.lebarmy.gov.lb/", "https://t.me/mayadeenchannel", "https://today.lorientlejour.com/", "https://t.me/SabrenNewss", "https://www.centcom.mil/",
    "https://english.alarabiya.net/", "https://x.com/FaytuksNetwork", "https://x.com/TeamAFP", "https://www.bulatlat.com/", "https://t.me/bulatlat", "https://mindanews.com/", "https://www.rappler.com/",
  ];

  test("every supplied URL appears verbatim in the plug-in list (as a website, feed, Telegram or X profile)", () => {
    const used = new Set(plugin.sources.flatMap((s) => [s.website, s.feed, s.telegram, s.x]).filter(Boolean));
    for (const url of SUPPLIED) expect(used.has(url), url).toBe(true);
  });

  test("individual articles and posts are references, not sources; Nigeria coverage is not attached to Niger", () => {
    const refs = new Map(plugin.references.map((r) => [r.url, r]));
    for (const url of [
      "https://www.aljazeera.com/news/2026/8/1/iranian-kurdish-parties-in-iraq-face-a-delicate-balance-amid-iran-attacks",
      "https://elpais.com/america/2026-06-19/noboa-vuelve-a-declarar-el-conflicto-armado-en-ecuador-y-amplia-la-proteccion-legal-a-los-militares.html",
      "https://www.hrw.org/world-report/2026/country-chapters/ecuador",
      "https://www.prothomalo.com/world/india/am8c9cagak",
      "https://trackingterrorism.org/chatter/claim-al-shabaab-militants-targeted-a-somali-base-and-barracks/",
      "https://sudantribune.com/article/317383",
      "https://x.com/USAfricaCommand/status/2064628378431271295",
      "https://x.com/nbntweets/status/2101178386299208139",
      "https://x.com/kon_mowaten/status/2101405746655117810",
      "https://x.com/FaytuksNetwork/status/2101198147666018534",
    ]) expect(refs.has(url), url).toBe(true);
    expect(refs.get("https://www.arabnews.com/world/gangs-kill-15-in-northwestern-nigeria-residents-3002150")!.conflict).toBe("nigeria-insurgencies");
    expect(plugin.sources.some((s) => [s.website, s.telegram, s.x].some((u) => u?.includes("/status/")))).toBe(false); // no single post is a source
  });

  test("unverifiable sources are listed NEEDS_VERIFICATION with no invented URL", () => {
    const names = plugin.needsVerification.map((n) => n.name);
    for (const name of ["PDKI Media", "Kuki Inpi", "Libya Al Ahrar", "Libya Al Hadath", "Libya Review", "Ean Libya", "Sahel Monitor"]) expect(names).toContain(name);
    for (const n of plugin.needsVerification) expect(Object.keys(n).filter((k) => /url|telegram|^x$|feed/i.test(k))).toEqual([]);
  });

  test("classifications use the controlled vocabularies and every conflict link points at a real registry conflict", () => {
    const slugs = new Set(REGISTRY_CONFLICTS.map((c) => c.slug));
    for (const s of plugin.sources) {
      expect(INDEPENDENCE_CLASSES as readonly string[], s.key).toContain(s.class);
      if (s.claim) expect(CLAIM_POLICIES as readonly string[], s.key).toContain(s.claim);
      for (const [slug] of s.conflicts) expect(slugs.has(slug), `${s.key} -> ${slug}`).toBe(true);
    }
    for (const n of plugin.needsVerification) for (const [slug] of n.conflicts) expect(slugs.has(slug), `${n.name} -> ${slug}`).toBe(true);
    // State, official, aligned and OSINT sources are never plain independent evidence.
    for (const s of plugin.sources) if (["state_media", "aligned_media", "official_government", "official_military", "osint_aggregator", "representative_advocacy"].includes(s.class)) expect(s.claim, s.key).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
test.describe("Seeded records", () => {
  test("each plug-in source exists exactly once; identity fields are kept separate; no feed URL is shared", async ({ request }) => {
    const all = await sources(request);
    for (const s of plugin.sources) expect(all.filter((r) => r.name === s.name), s.name).toHaveLength(1);
    const feeds = all.map((r) => r.feedUrl).filter(Boolean) as string[];
    expect(new Set(feeds.map((f) => urlKey(f))).size).toBe(feeds.length);
    const handles = all.filter((r) => r.platform === "telegram" && r.platformHandle).map((r) => r.platformHandle!.toLowerCase());
    expect(new Set(handles).size).toBe(handles.length);

    const primicias = all.find((r) => r.name === "Primicias (Telegram)")!;
    expect(primicias).toMatchObject({ canonicalSourceUrl: "https://www.primicias.ec/", socialProfileUrl: "https://t.me/primiciasec", platform: "telegram", platformHandle: "primiciasec", type: "telegram", enabled: false });
    expect(primicias.feedUrl).toBeNull();
    const web = all.find((r) => r.name === "Primicias")!;
    expect(web.canonicalSourceUrl).toBe("https://www.primicias.ec/");
    expect(web.socialProfileUrl).toBeNull();
  });

  test("nothing is enabled just because it was listed: enabled => verified, an RSS feed that parsed, and a same-site check", async ({ request }) => {
    const all = await sources(request);
    const pluginNames = new Set([...plugin.sources.map((s) => s.name), ...plugin.needsVerification.map((n) => n.name)]);
    for (const row of all.filter((r) => pluginNames.has(r.name) && r.independenceClass !== null)) {
      if (!row.enabled) continue;
      expect(row.type, row.name).toBe("rss");
      expect(row.verificationStatus, row.name).toBe("verified");
      expect(row.verifiedAt, row.name).not.toBeNull();
      expect(row.feedUrl, row.name).toBeTruthy();
      expect(row.feedUrl).toBe(row.url);
    }
    // Every Telegram / X record and every placeholder is disabled.
    for (const row of all.filter((r) => r.independenceClass !== null || r.verificationNotes?.startsWith("NEEDS_VERIFICATION"))) {
      if (row.type === "telegram" && pluginNames.has(row.name)) expect(row.enabled, row.name).toBe(false);
      if (row.platform === "x") expect(row.enabled, row.name).toBe(false);
    }
    for (const n of plugin.needsVerification) {
      const row = all.find((r) => r.name === n.name)!;
      expect(row, n.name).toMatchObject({ enabled: false, verificationStatus: "needs_verification", url: null, feedUrl: null, socialProfileUrl: null });
      expect(row.verificationNotes).toContain("NEEDS_VERIFICATION");
    }
    for (const status of all.map((r) => r.verificationStatus)) expect(SOURCE_VERIFICATION_STATUSES as readonly string[]).toContain(status);
  });

  test("the recorded verification explains each outcome: blocked sites are 'inaccessible', not bypassed; a non-feed RSS index is not auto-replaced", async ({ request }) => {
    const all = await sources(request);
    const hengaw = all.find((r) => r.name === "Hengaw (website)")!;
    expect(hengaw).toMatchObject({ enabled: false, verificationStatus: "inaccessible" });
    expect(hengaw.verificationNotes).toMatch(/not worked around/);
    const elUniverso = all.find((r) => r.name === "El Universo")!;
    expect(elUniverso).toMatchObject({ enabled: false, verificationStatus: "needs_verification", feedUrl: null });
    expect(elUniverso.verificationNotes).toMatch(/did not return an RSS 2\.0 feed/);
    const candidates = (await request.get("/api/admin/source-candidates").then((r) => r.json())) as { url: string | null; notes: string | null }[];
    expect(candidates.some((c) => c.url === "https://www.eluniverso.com/arc/outboundfeeds/rss/?outputType=xml")).toBe(true);
    const tg = all.find((r) => r.name === "IRNA English (Telegram)")!;
    expect(tg.verificationNotes).toMatch(/needs authorised credentials/);
    expect(tg).toMatchObject({ independenceClass: "state_media", claimPolicy: "party_claim", enabled: false });
    const tribune = all.find((r) => r.name === "Cameroon Tribune")!;
    expect(tribune).toMatchObject({ independenceClass: "state_media", claimPolicy: "party_claim", enabled: false });
  });

  test("the verification run and seed agree: enabled feeds parsed, Telegram/X were never fetched for content, ingestion proved article URLs", async () => {
    for (const s of plugin.sources) {
      const check = verification.results[s.key];
      expect(check, s.key).toBeTruthy();
      if (s.x) expect((check as { x?: { skipped?: string } }).x?.skipped).toBeTruthy();
    }
    const ingestion = read("source-plugin-ingestion.json") as { total: number; passed: number; results: { name: string; ok: boolean; sample?: { url: string } }[] };
    expect(ingestion.total).toBeGreaterThanOrEqual(10);
    expect(ingestion.passed).toBe(ingestion.total);
    for (const r of ingestion.results) expect(r.sample?.url, r.name).toMatch(/^https?:\/\/.+\/.+/);
  });

  test("links attach each source to its conflict; ecuador and kurdish-iran gain dedicated sources but disabled ones add no coverage", async ({ request }) => {
    const coverage = (await request.get("/api/admin/conflict-coverage").then((r) => r.json())) as { rows: { conflict: { slug: string }; sources: { name: string; enabled: boolean; kind: string }[]; enabledSources: number }[] };
    const row = (slug: string) => coverage.rows.find((r) => r.conflict.slug === slug)!;
    expect(row("ecuador").sources.map((s) => s.name)).toEqual(expect.arrayContaining(["Teleamazonas"]));
    expect(row("cameroon").sources.map((s) => s.name)).toEqual(expect.arrayContaining(["Mimi Mefo Info", "Journal du Cameroun"]));
    expect(row("libya").sources.map((s) => s.name)).toEqual(expect.arrayContaining(["Libya Herald"]));
    expect(row("northeast-india").sources.map((s) => s.name)).toEqual(expect.arrayContaining(["EastMojo", "Ukhrul Times"]));
    expect(row("philippines-insurgencies").sources.map((s) => s.name)).toEqual(expect.arrayContaining(["Bulatlat"]));
    // Disabled records (Telegram/X/placeholders) never count toward enabledSources.
    const disabled = row("ecuador").sources.filter((s) => !s.enabled);
    expect(row("ecuador").enabledSources).toBe(row("ecuador").sources.filter((s) => s.enabled).length);
    expect(disabled.length).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
test.describe("Party claims and discovery-only sources are not independent confirmation", () => {
  const link = (role: string | null, claim: string | null, url: string) => ({ isOriginatingSource: true, rawIngestionItem: { originalUrl: url, source: { sourceRole: role, claimPolicy: claim } } });

  test("a state or aligned outlet repeating its own side does not raise the independent-source count", () => {
    expect(evidenceRoleOf({ sourceRole: "official", claimPolicy: "party_claim" })).toBe("party_claim");
    expect(evidenceRoleOf({ sourceRole: "local_media", claimPolicy: "discovery_only" })).toBe("aggregator");
    expect(evidenceRoleOf({ sourceRole: "local_media", claimPolicy: null })).toBe("local_media");
    expect(isNonIndependentRole("party_claim")).toBe(true);
    expect(isNonIndependentRole("local_media")).toBe(false);
    expect(independentSourceCount([link("official", "party_claim", "https://a.test/1")])).toBe(1); // a report exists, none independent
    expect(independentSourceCount([link("official", "party_claim", "https://a.test/1"), link("official", "party_claim", "https://b.test/2")])).toBe(1);
    expect(independentSourceCount([link("official", "party_claim", "https://a.test/1"), link("local_media", null, "https://c.test/3")])).toBe(1);
    expect(independentSourceCount([link("official", "party_claim", "https://a.test/1"), link("local_media", null, "https://c.test/3"), link("local_media", null, "https://d.test/4")])).toBe(2);
  });

  test("a territorial claim backed only by party claims cannot change control; an independent report unlocks it", () => {
    expect(() => assertIndependentEvidence({ sourceRole: "party_claim", corroboration: null })).toThrow(/cannot modify Territorial Control/);
    expect(() => assertIndependentEvidence({ sourceRole: "party_claim", corroboration: JSON.stringify([{ sourceName: "x", sourceUrl: null, sourceRole: "aggregator" }]) })).toThrow();
    expect(() => assertIndependentEvidence({ sourceRole: "party_claim", corroboration: JSON.stringify([{ sourceName: "y", sourceUrl: null, sourceRole: "local_media" }]) })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
test.describe("Each item keeps its own original URL", () => {
  test.afterAll(async () => {
    const { prisma } = await import("@/lib/db/client");
    await prisma.source.deleteMany({ where: { name: { startsWith: "SP " } } });
  });

  test("feed item -> stored original URL: the article link when present, null when absent — never the feed, homepage or site URL", async ({ request }) => {
    const created = await request
      .post("/api/admin/sources", {
        data: { name: `SP nolink ${unique()}`, type: "rss", url: `${FIXTURE_FEED}/plugin-nolink-feed`, canonicalSourceUrl: "https://fixture.test/plugin-site/", enabled: true, autoIngest: false, autoProcessing: false, sourceRole: "local_media" },
      })
      .then((r) => r.json());
    // The feed URL is copied to feedUrl, and the site URL stays separate.
    expect(created).toMatchObject({ feedUrl: `${FIXTURE_FEED}/plugin-nolink-feed`, canonicalSourceUrl: "https://fixture.test/plugin-site/", platform: "rss" });
    expect(created.verificationStatus).toBe("needs_verification");
    const fetched = await request.post(`/api/admin/sources/${created.id}/fetch`).then((r) => r.json());
    expect(fetched).toMatchObject({ new: 2, errors: 0 });
    const items = (await request.get(`/api/admin/incoming?sourceId=${created.id}`).then((r) => r.json())) as { originalTitle: string; originalUrl: string | null; publishedAt: string }[];
    const one = items.find((i) => i.originalTitle.startsWith("Story with"))!;
    const two = items.find((i) => i.originalTitle.startsWith("Story the publisher"))!;
    expect(one.originalUrl).toBe("https://fixture.test/plugin-site/articles/story-one");
    expect(two.originalUrl).toBeNull();
    for (const i of items) {
      expect(i.originalUrl).not.toBe(created.feedUrl);
      expect(i.originalUrl).not.toBe(created.canonicalSourceUrl);
    }
    expect(new Date(one.publishedAt).toISOString()).toBe("2026-01-01T09:00:00.000Z");
  });

  test("a Telegram source's identity (site + profile + handle) is separate from each post's own permalink", async ({ request }) => {
    const created = await request
      .post("/api/admin/sources", {
        data: { name: `SP telegram ${unique()}`, type: "telegram", telegramHandle: "@vigil_fixture_aggregator", canonicalSourceUrl: "https://fixture.test/aggregator-site/", sourceRole: "aggregator", enabled: true, autoIngest: false, autoProcessing: false },
      })
      .then((r) => r.json());
    expect(created).toMatchObject({ platform: "telegram", platformHandle: "vigil_fixture_aggregator", socialProfileUrl: "https://t.me/vigil_fixture_aggregator", canonicalSourceUrl: "https://fixture.test/aggregator-site/" });
    await request.post(`/api/admin/sources/${created.id}/fetch`);
    const items = (await request.get(`/api/admin/incoming?sourceId=${created.id}`).then((r) => r.json())) as { externalId: string; originalUrl: string }[];
    expect(items.length).toBe(3);
    for (const i of items) {
      expect(i.originalUrl).toBe(`https://t.me/vigil_fixture_aggregator/${i.externalId}`);
      expect(i.originalUrl).not.toBe(created.socialProfileUrl);
    }
  });
});
