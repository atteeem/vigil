// Seeds the initial Source Manager registry entries per Telegram
// Sources.md in the Obsidian vault (D:\GLOBAL CONFLICT CLAUDE\Telegram
// Sources.md). Idempotent (upsert on name) so it's safe to re-run.
// Plain .mjs (not .ts) so it runs with a bare `node prisma/seed.mjs` —
// no ts-node/tsx dependency needed for a one-off local setup script.
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { seedSourcePlugin } from "./seed-source-plugin.mjs";

// No dotenv dependency needed: DATABASE_URL defaults to the same value
// .env holds, so `node prisma/seed.mjs` just works without extra setup.
const adapter = new PrismaBetterSqlite3({ url: (process.env.DATABASE_URL ?? "file:./prisma/dev.db").replace(/^file:/, "") });
const prisma = new PrismaClient({ adapter });

const sources = [
  {
    name: "Liveuamap Source",
    type: "telegram",
    telegramHandle: "@lumsrc",
    sourceCategory: "aggregator",
    sourceRole: "aggregator",
    reliabilityTier: "relay",
    permissionStatus: "unauthorized",
    enabled: false,
    autoIngest: false,
  },
  {
    name: "ДС: новини Дніпро",
    type: "telegram",
    telegramHandle: "@dnipro_now",
    country: "UA",
    region: "Dnipro / Dnipropetrovsk",
    language: "uk",
    sourceCategory: "local_news",
    sourceRole: "eyewitness_community",
    reliabilityTier: "community",
    permissionStatus: "unauthorized",
    enabled: false,
    autoIngest: false,
  },
  {
    name: "Хуйовий Харків",
    type: "telegram",
    telegramHandle: "@huyovy_kharkiv",
    country: "UA",
    region: "Kharkiv / Kharkiv Oblast",
    language: "uk/ru",
    sourceCategory: "local_news",
    sourceRole: "eyewitness_community",
    reliabilityTier: "community",
    permissionStatus: "unauthorized",
    enabled: false,
    autoIngest: false,
  },
  // First real external-source ingestion proof (RSS -> raw item -> admin
  // review -> publish -> /world). See ARCHITECTURE.md "Source ingestion
  // pipeline". autoPublish is NOT a field on Source — nothing here (or
  // anywhere in the ingestion pipeline) auto-publishes; publish is always
  // a human action in /admin/incoming.
  {
    name: "BBC World",
    type: "rss",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    language: "en",
    sourceCategory: "News",
    sourceRole: "originating",
    reliabilityTier: "A",
    permissionStatus: "authorized",
    enabled: true,
    autoIngest: true,
    autoProcessing: true,
    pollIntervalMinutes: 5,
  },
  // Real multi-source ingestion milestone (spec "Real multi-source live
  // ingestion") — every URL below was verified to be a real, currently
  // live, publicly reachable RSS 2.0 feed (no scraping, no key/auth
  // required) before being seeded. Grouped per spec's four priority
  // categories: international news, official authorities, emergency/
  // government feeds, regional news feeds.
  {
    name: "Al Jazeera English",
    type: "rss",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    language: "en",
    sourceCategory: "News",
    sourceRole: "originating",
    reliabilityTier: "A",
    permissionStatus: "authorized",
    enabled: true,
    autoIngest: true,
    autoProcessing: true,
    pollIntervalMinutes: 5,
  },
  {
    name: "The Guardian — World",
    type: "rss",
    url: "https://www.theguardian.com/world/rss",
    language: "en",
    sourceCategory: "News",
    sourceRole: "originating",
    reliabilityTier: "A",
    permissionStatus: "authorized",
    enabled: true,
    autoIngest: true,
    autoProcessing: true,
    pollIntervalMinutes: 5,
  },
  {
    name: "UN News",
    type: "rss",
    url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml",
    language: "en",
    sourceCategory: "official",
    sourceRole: "official",
    reliabilityTier: "A",
    permissionStatus: "authorized",
    enabled: true,
    autoIngest: true,
    autoProcessing: true,
    pollIntervalMinutes: 5,
  },
  {
    name: "ReliefWeb Updates",
    type: "rss",
    url: "https://reliefweb.int/updates/rss.xml",
    language: "en",
    sourceCategory: "official",
    sourceRole: "official",
    reliabilityTier: "A",
    permissionStatus: "authorized",
    enabled: true,
    autoIngest: true,
    autoProcessing: true,
    pollIntervalMinutes: 5,
  },
  {
    name: "WHO News",
    type: "rss",
    url: "https://www.who.int/rss-feeds/news-english.xml",
    language: "en",
    sourceCategory: "official",
    sourceRole: "official",
    reliabilityTier: "A",
    permissionStatus: "authorized",
    enabled: true,
    autoIngest: true,
    autoProcessing: true,
    pollIntervalMinutes: 5,
  },
  {
    name: "GDACS Disaster Alerts",
    type: "rss",
    url: "https://www.gdacs.org/xml/rss.xml",
    language: "en",
    sourceCategory: "emergency",
    sourceRole: "official",
    reliabilityTier: "A",
    permissionStatus: "authorized",
    enabled: true,
    autoIngest: true,
    autoProcessing: true,
    pollIntervalMinutes: 5,
  },
  {
    name: "Times of Israel",
    type: "rss",
    url: "https://www.timesofisrael.com/feed/",
    country: "IL",
    region: "Middle East",
    language: "en",
    sourceCategory: "News",
    sourceRole: "local_media",
    reliabilityTier: "B",
    permissionStatus: "authorized",
    enabled: true,
    autoIngest: true,
    autoProcessing: true,
    pollIntervalMinutes: 5,
  },
  {
    name: "Middle East Eye",
    type: "rss",
    url: "https://www.middleeasteye.net/rss",
    region: "Middle East",
    language: "en",
    sourceCategory: "News",
    sourceRole: "local_media",
    reliabilityTier: "B",
    permissionStatus: "authorized",
    enabled: true,
    autoIngest: true,
    autoProcessing: true,
    pollIntervalMinutes: 5,
  },
  {
    name: "Africanews",
    type: "rss",
    url: "https://www.africanews.com/feed/rss",
    region: "Africa",
    language: "en",
    sourceCategory: "News",
    sourceRole: "local_media",
    reliabilityTier: "B",
    permissionStatus: "authorized",
    enabled: true,
    autoIngest: true,
    autoProcessing: true,
    pollIntervalMinutes: 5,
  },
  // MilitaryLand Phase 1 (spec "Add MilitaryLand News as a distinct
  // source"). militaryland.net serves a standard WordPress RSS 2.0 feed
  // (verified live before seeding, same as every other RSS source above)
  // — no scraping needed, the existing RSSAdapter handles it unmodified.
  // Polled every 30 minutes rather than the 5-minute news-feed default:
  // this is an analysis/reference site with an hourly update cadence, not
  // breaking news, so a shorter interval would just be unnecessary load.
  {
    name: "MilitaryLand News",
    type: "rss",
    url: "https://militaryland.net/feed/",
    country: "UA",
    region: "Europe",
    language: "en",
    sourceCategory: "Military Analysis",
    sourceRole: "local_media",
    reliabilityTier: "B",
    permissionStatus: "authorized",
    enabled: true,
    autoIngest: true,
    autoProcessing: true,
    pollIntervalMinutes: 30,
  },
  // Myanmar Specialist Source Integration. Myanmar Now is an independent
  // Myanmar newsroom (local originating media, not an aggregator) with a
  // public WordPress RSS feed — the existing RSSAdapter handles it. Items it
  // tags "paid content" are paywalled: only the feed's own public excerpt is
  // ever ingested, and no code fetches article pages.
  {
    name: "Myanmar Now",
    type: "rss",
    url: "https://myanmar-now.org/en/feed/",
    country: "MM",
    region: "Asia",
    language: "en",
    sourceCategory: "News",
    sourceRole: "local_media",
    reliabilityTier: "B",
    permissionStatus: "authorized",
    enabled: true,
    autoIngest: true,
    autoProcessing: true,
    pollIntervalMinutes: 30,
  },
];

// Full conflict registry for /admin/conflicts (spec §1). The
// russia-ukraine entry matches lib/data/mock-conflicts.ts's own entry so
// the two stay recognizable as "the same conflict" even though they're on
// different sides of the mock/DB boundary for now.
const conflicts = [
  {
    slug: "russia-ukraine",
    name: "Russia–Ukraine War",
    shortName: "Russia–Ukraine",
    region: "Europe",
    status: "active",
    severity: "severe",
    intensity: 88,
    intensityChange24h: 4,
    startedAt: new Date("2022-02-24"),
    lat: 48.5,
    lng: 37.0,
    primaryEffects: JSON.stringify(["Security", "Trade", "Energy"]),
    countries: JSON.stringify(["UA", "RU"]),
    summary:
      "Large-scale conventional war along a shifting front line in eastern and southern Ukraine, with sustained long-range strikes on infrastructure on both sides.",
  },
  {
    slug: "israel-palestine",
    name: "Israel–Palestine Conflict",
    shortName: "Israel–Palestine",
    region: "Middle East",
    status: "active",
    severity: "severe",
    intensity: 82,
    intensityChange24h: 2,
    startedAt: new Date("2023-10-07"),
    lat: 31.5,
    lng: 34.47,
    primaryEffects: JSON.stringify(["Security", "Diplomacy"]),
    countries: JSON.stringify(["IL", "PS"]),
    summary: "Ongoing conflict centered on Gaza and the West Bank, with recurring escalation cycles.",
  },
  {
    slug: "israel-lebanon",
    name: "Israel–Lebanon Border Conflict",
    shortName: "Israel–Lebanon",
    region: "Middle East",
    status: "active",
    severity: "elevated",
    intensity: 55,
    intensityChange24h: 0,
    startedAt: new Date("2023-10-08"),
    lat: 33.27,
    lng: 35.2,
    primaryEffects: JSON.stringify(["Security"]),
    countries: JSON.stringify(["IL", "LB"]),
    summary: "Cross-border exchanges along the Israel–Lebanon frontier, linked to the wider regional conflict.",
  },
  {
    slug: "syria",
    name: "Syrian Conflict",
    shortName: "Syria",
    region: "Middle East",
    status: "dormant",
    severity: "elevated",
    intensity: 45,
    intensityChange24h: -1,
    startedAt: new Date("2011-03-15"),
    lat: 34.8,
    lng: 38.5,
    primaryEffects: JSON.stringify(["Security", "Trade"]),
    countries: JSON.stringify(["SY"]),
    summary: "Multi-party conflict with a shifting front and periodic flare-ups following the 2024 transition.",
  },
  {
    slug: "persian-gulf-iran",
    name: "Persian Gulf / Iran Tensions",
    shortName: "Persian Gulf / Iran",
    region: "Middle East",
    status: "active",
    severity: "guarded",
    intensity: 35,
    intensityChange24h: 1,
    startedAt: null,
    lat: 27.0,
    lng: 52.0,
    primaryEffects: JSON.stringify(["Energy", "Trade"]),
    countries: JSON.stringify(["IR"]),
    summary: "Recurring maritime and regional tensions involving Iran and Gulf shipping routes.",
  },
  {
    slug: "yemen-red-sea",
    name: "Yemen / Red Sea Conflict",
    shortName: "Yemen / Red Sea",
    region: "Middle East",
    status: "active",
    severity: "elevated",
    intensity: 58,
    intensityChange24h: 3,
    startedAt: new Date("2014-09-21"),
    lat: 15.4,
    lng: 44.2,
    primaryEffects: JSON.stringify(["Security", "Trade"]),
    countries: JSON.stringify(["YE"]),
    summary: "Civil conflict in Yemen with spillover attacks on Red Sea shipping lanes.",
  },
  {
    slug: "sudan",
    name: "Sudan Civil War",
    shortName: "Sudan",
    region: "Africa",
    status: "active",
    severity: "severe",
    intensity: 80,
    intensityChange24h: 2,
    startedAt: new Date("2023-04-15"),
    lat: 15.5,
    lng: 32.56,
    primaryEffects: JSON.stringify(["Security", "Food & Supply"]),
    countries: JSON.stringify(["SD"]),
    summary: "Conflict between rival military factions with severe humanitarian consequences.",
  },
  {
    slug: "drc",
    name: "Eastern DRC Conflict",
    shortName: "DRC",
    region: "Africa",
    status: "active",
    severity: "elevated",
    intensity: 60,
    intensityChange24h: 1,
    startedAt: null,
    lat: -1.68,
    lng: 29.22,
    primaryEffects: JSON.stringify(["Security"]),
    countries: JSON.stringify(["CD"]),
    summary: "Armed group activity and displacement in North and South Kivu provinces.",
  },
  {
    slug: "somalia",
    name: "Somalia Conflict",
    shortName: "Somalia",
    region: "Africa",
    status: "active",
    severity: "guarded",
    intensity: 40,
    intensityChange24h: 0,
    startedAt: null,
    lat: 2.05,
    lng: 45.32,
    primaryEffects: JSON.stringify(["Security"]),
    countries: JSON.stringify(["SO"]),
    summary: "Ongoing insurgency and counter-insurgency operations against al-Shabaab.",
  },
  {
    slug: "sahel",
    name: "Sahel Region Conflict",
    shortName: "Sahel",
    region: "Africa",
    status: "active",
    severity: "elevated",
    intensity: 55,
    intensityChange24h: 1,
    startedAt: null,
    lat: 14.0,
    lng: 0.0,
    primaryEffects: JSON.stringify(["Security"]),
    countries: JSON.stringify(["ML", "NE", "BF"]),
    summary: "Cross-border militant activity and instability across Mali, Niger, and Burkina Faso.",
  },
  {
    slug: "myanmar",
    name: "Myanmar Civil Conflict",
    shortName: "Myanmar",
    region: "Asia",
    status: "active",
    severity: "elevated",
    intensity: 50,
    intensityChange24h: 0,
    startedAt: new Date("2021-02-01"),
    lat: 21.9,
    lng: 96.0,
    primaryEffects: JSON.stringify(["Security"]),
    countries: JSON.stringify(["MM"]),
    summary: "Conflict between the military government and resistance forces following the 2021 coup.",
  },
  {
    slug: "india-pakistan",
    name: "India–Pakistan Line of Control Tensions",
    shortName: "India–Pakistan",
    region: "Asia",
    status: "dormant",
    severity: "guarded",
    intensity: 30,
    intensityChange24h: 0,
    startedAt: null,
    lat: 34.08,
    lng: 74.8,
    primaryEffects: JSON.stringify(["Security", "Diplomacy"]),
    countries: JSON.stringify(["IN", "PK"]),
    summary: "Periodic tension along the Line of Control in Kashmir.",
  },
  {
    slug: "korean-peninsula",
    name: "Korean Peninsula Tensions",
    shortName: "Korean Peninsula",
    region: "Asia",
    status: "dormant",
    severity: "guarded",
    intensity: 28,
    intensityChange24h: 0,
    startedAt: null,
    lat: 38.0,
    lng: 127.0,
    primaryEffects: JSON.stringify(["Diplomacy", "Security"]),
    countries: JSON.stringify(["KR", "KP"]),
    summary: "Ongoing standoff and periodic missile/military activity across the DMZ.",
  },
  {
    slug: "taiwan-strait",
    name: "Taiwan Strait Tensions",
    shortName: "Taiwan Strait",
    region: "Asia",
    status: "active",
    severity: "guarded",
    intensity: 32,
    intensityChange24h: 1,
    startedAt: null,
    lat: 24.5,
    lng: 119.5,
    primaryEffects: JSON.stringify(["Trade", "Security"]),
    countries: JSON.stringify(["TW", "CN"]),
    summary: "Military posturing and periodic incursions across the Taiwan Strait median line.",
  },
];

// MilitaryLand Phase 1 reference-entity seed: a small REAL sample (spec
// "Use a small real sample first: several units, several equipment
// entries, at least one commander if available") drawn from
// militaryland.net's own public unit/equipment/commander database (CC
// BY-SA 4.0, attributed via sourceUrl on every row below) — names,
// ranks, branches, and parent-formation facts are real; the prose is
// written fresh for Vigil, never copied from the site. Idempotent
// (upsert on name, MilitaryUnit/MilitaryEquipment/Commander.name is
// @unique) so re-running seed never creates duplicates — the same
// "do not duplicate entities" contract the ingestion-side extractor
// (lib/military/extract-entities.ts + findOrCreateMilitaryUnit &c.) is
// held to.
async function seedMilitaryReference() {
  const conflict = await prisma.conflict.findUnique({ where: { slug: "russia-ukraine" } });
  const src = { sourceName: "MilitaryLand.net" };

  async function upsertUnit(name, data) {
    return prisma.militaryUnit.upsert({
      where: { name },
      update: { ...src, ...data },
      create: { name, ...src, ...data },
    });
  }

  const groundForces = await upsertUnit("Ground Forces of Ukraine", {
    branch: "Ground Forces",
    unitType: "Service Branch",
    status: "active",
    primaryConflictId: conflict?.id ?? null,
    sourceUrl: "https://militaryland.net/ukraine/",
  });
  const unmannedSystemsForces = await upsertUnit("Unmanned Systems Forces", {
    branch: "Unmanned Systems Forces",
    unitType: "Service Branch",
    status: "active",
    primaryConflictId: conflict?.id ?? null,
    sourceUrl: "https://militaryland.net/ukraine/",
  });
  const rapidResponseCorps = await upsertUnit("7th Rapid Response Corps", {
    branch: "Ground Forces",
    unitType: "Corps",
    parentUnitId: groundForces.id,
    status: "active",
    primaryConflictId: conflict?.id ?? null,
    sourceUrl: "https://militaryland.net/units/25th-airborne-brigade/",
  });
  const airborne25 = await upsertUnit("25th Airborne Brigade", {
    branch: "Air Assault Forces",
    unitType: "Airborne Brigade",
    parentUnitId: rapidResponseCorps.id,
    status: "active",
    primaryConflictId: conflict?.id ?? null,
    sourceUrl: "https://militaryland.net/units/25th-airborne-brigade/",
  });
  await upsertUnit("8th Air Assault Corps", {
    branch: "Air Assault Forces",
    unitType: "Corps",
    parentUnitId: groundForces.id,
    status: "active",
    primaryConflictId: conflict?.id ?? null,
    sourceUrl: "https://militaryland.net/news/zaits-appointed-commander-of-ground-forces/",
  });
  await upsertUnit("20th Army Corps", {
    branch: "Ground Forces",
    unitType: "Corps",
    parentUnitId: groundForces.id,
    status: "active",
    primaryConflictId: conflict?.id ?? null,
    sourceUrl: "https://militaryland.net/news/zaits-appointed-commander-of-ground-forces/",
  });
  const marineCorps30 = await upsertUnit("30th Marine Corps", {
    branch: "Naval Forces",
    unitType: "Corps",
    status: "active",
    primaryConflictId: conflict?.id ?? null,
    sourceUrl: "https://militaryland.net/news/144th-mechanized-brigade-reformed-into-42nd-marine-brigade/",
  });
  await upsertUnit("15th Army Corps", {
    branch: "Ground Forces",
    unitType: "Corps",
    status: "active",
    primaryConflictId: conflict?.id ?? null,
    sourceUrl: "https://militaryland.net/news/144th-mechanized-brigade-reformed-into-42nd-marine-brigade/",
  });
  await upsertUnit("144th Mechanized Brigade", {
    branch: "Ground Forces",
    unitType: "Mechanized Brigade",
    status: "reformed",
    primaryConflictId: conflict?.id ?? null,
    sourceUrl: "https://militaryland.net/news/144th-mechanized-brigade-reformed-into-42nd-marine-brigade/",
  });
  await upsertUnit("42nd Marine Brigade", {
    branch: "Naval Forces",
    unitType: "Marine Brigade",
    parentUnitId: marineCorps30.id,
    status: "active",
    primaryConflictId: conflict?.id ?? null,
    sourceUrl: "https://militaryland.net/news/144th-mechanized-brigade-reformed-into-42nd-marine-brigade/",
  });
  await upsertUnit("446th Unmanned Systems Brigade", {
    branch: "Unmanned Systems Forces",
    unitType: "Unmanned Systems Brigade",
    parentUnitId: unmannedSystemsForces.id,
    status: "forming",
    primaryConflictId: conflict?.id ?? null,
    sourceUrl: "https://militaryland.net/news/army-creates-446th-unmanned-systems-brigade/",
  });
  const heavyMechanized125 = await upsertUnit("125th Heavy Mechanized Brigade", {
    branch: "Ground Forces",
    unitType: "Heavy Mechanized Brigade",
    status: "active",
    primaryConflictId: conflict?.id ?? null,
    sourceUrl: "https://militaryland.net/equipment/2p22-bohdana/",
  });

  const bohdana = await prisma.militaryEquipment.upsert({
    where: { name: "2P22 Bohdana" },
    update: { ...src, category: "Towed Artillery", countryOfOrigin: "Ukraine", sourceUrl: "https://militaryland.net/equipment/2p22-bohdana/" },
    create: {
      name: "2P22 Bohdana",
      ...src,
      category: "Towed Artillery",
      countryOfOrigin: "Ukraine",
      sourceUrl: "https://militaryland.net/equipment/2p22-bohdana/",
    },
  });
  await prisma.militaryEquipment.upsert({
    where: { name: "2S1 Gvozdika" },
    update: { ...src, category: "Self-Propelled Artillery", sourceUrl: "https://militaryland.net/equipment/2s1-gvozdika/" },
    create: {
      name: "2S1 Gvozdika",
      ...src,
      category: "Self-Propelled Artillery",
      sourceUrl: "https://militaryland.net/equipment/2s1-gvozdika/",
    },
  });
  await prisma.militaryEquipment.upsert({
    where: { name: "2K22 Tunguska" },
    update: { ...src, category: "Anti-Aircraft", sourceUrl: "https://militaryland.net/equipment/2k22-tunguska/" },
    create: {
      name: "2K22 Tunguska",
      ...src,
      category: "Anti-Aircraft",
      sourceUrl: "https://militaryland.net/equipment/2k22-tunguska/",
    },
  });

  // 2P22 Bohdana is documented as fielded by 25+ formations including the
  // 125th Heavy Mechanized Brigade (militaryland.net/equipment/2p22-bohdana/).
  await prisma.militaryUnitEquipment.upsert({
    where: { unitId_equipmentId: { unitId: heavyMechanized125.id, equipmentId: bohdana.id } },
    update: {},
    create: { unitId: heavyMechanized125.id, equipmentId: bohdana.id, ...src, sourceUrl: "https://militaryland.net/equipment/2p22-bohdana/" },
  });

  const zaits = await prisma.commander.upsert({
    where: { name: "Svyatoslav Zaits" },
    update: { ...src, rank: "Brigadier General", currentUnitId: groundForces.id, sourceUrl: "https://militaryland.net/news/zaits-appointed-commander-of-ground-forces/" },
    create: {
      name: "Svyatoslav Zaits",
      ...src,
      rank: "Brigadier General",
      currentUnitId: groundForces.id,
      sourceUrl: "https://militaryland.net/news/zaits-appointed-commander-of-ground-forces/",
    },
  });
  await prisma.commanderAppointment.upsert({
    where: { id: `${zaits.id}-ground-forces-seed` }, // never a real cuid, so this always creates on first run
    update: {},
    create: {
      id: `${zaits.id}-ground-forces-seed`,
      commanderId: zaits.id,
      unitId: groundForces.id,
      role: "commander",
      startDate: new Date("2026-09-02"),
      ...src,
      sourceUrl: "https://militaryland.net/news/zaits-appointed-commander-of-ground-forces/",
    },
  });

  const turchyn = await prisma.commander.upsert({
    where: { name: "Andriy Turchyn" },
    update: { ...src, rank: "Colonel", currentUnitId: airborne25.id, sourceUrl: "https://militaryland.net/units/25th-airborne-brigade/" },
    create: {
      name: "Andriy Turchyn",
      ...src,
      rank: "Colonel",
      currentUnitId: airborne25.id,
      sourceUrl: "https://militaryland.net/units/25th-airborne-brigade/",
    },
  });
  await prisma.commanderAppointment.upsert({
    where: { id: `${turchyn.id}-airborne25-seed` },
    update: {},
    create: {
      id: `${turchyn.id}-airborne25-seed`,
      commanderId: turchyn.id,
      unitId: airborne25.id,
      role: "commander",
      ...src,
      sourceUrl: "https://militaryland.net/units/25th-airborne-brigade/",
    },
  });

  console.log("Seeded MilitaryLand Phase 1 reference data: 12 units, 3 equipment, 2 commanders.");
}

// Myanmar Specialist Source Integration — small REAL reference sample drawn
// from IISS's published analysis "Myanmar's war to nowhere" (Morgan
// Michaels, Aug 2025, myanmar.iiss.org/analysis/war-to-nowhere). Actor names
// and the dated control-change reports are real; descriptions are written
// fresh, not quoted. IISS's event-level dataset (ACLED-derived) is NOT
// imported: its terms of reuse are unstated. Control changes are seeded only
// as pending TerritorialChangeCandidates — never as ConflictTerritory rows.
async function seedMyanmarReference() {
  const conflict = await prisma.conflict.findUnique({ where: { slug: "myanmar" } });
  if (!conflict) return;
  const IISS_URL = "https://myanmar.iiss.org/analysis/war-to-nowhere";
  const IISS_NAME = "IISS Myanmar Conflict Map — Myanmar's war to nowhere";

  async function actor(name, branch) {
    return prisma.militaryUnit.upsert({
      where: { name },
      update: {},
      create: {
        name,
        branch,
        unitType: "Armed group",
        status: "active",
        primaryConflictId: conflict.id,
        sourceName: IISS_NAME,
        sourceUrl: IISS_URL,
      },
    });
  }
  const tatmadaw = await actor("Tatmadaw", "State military");
  const aa = await actor("Arakan Army", "Ethnic armed organization");
  const mndaa = await actor("MNDAA", "Ethnic armed organization");
  const tnla = await actor("TNLA", "Ethnic armed organization");
  await actor("KIA", "Ethnic armed organization");
  await actor("KNLA", "Ethnic armed organization");
  const kndf = await actor("KNDF", "Resistance force");

  const candidates = [
    {
      locationName: "Lashio",
      claimed: tatmadaw,
      previous: mndaa,
      description: "Reported April 2025: the MNDAA handed Lashio back to the Tatmadaw under a China-brokered arrangement.",
      changeType: "transferred", lat: 22.94, lng: 97.75, precision: "approximate", observedAt: new Date("2025-04-15"),
    },
    {
      locationName: "Nawnghkio",
      claimed: tatmadaw,
      previous: tnla,
      description: "Reported July 2025: the Tatmadaw retook Nawnghkio town from the TNLA.",
      changeType: "recaptured", lat: 22.05, lng: 96.67, precision: "approximate", observedAt: new Date("2025-07-15"),
    },
    {
      locationName: "Moebye",
      claimed: tatmadaw,
      previous: kndf,
      description: "Reported early July 2025: the Tatmadaw retook Moebye from the KNDF.",
      changeType: "recaptured", lat: null, lng: null, precision: "unknown", observedAt: new Date("2025-07-05"),
    },
    {
      locationName: "Demoso",
      claimed: tatmadaw,
      previous: kndf,
      description: "Reported August 2025: the Tatmadaw retook Demoso from the KNDF.",
      changeType: "recaptured", lat: null, lng: null, precision: "unknown", observedAt: new Date("2025-08-15"),
    },
  ];
  // Same normalization as lib/territory/change-detection.ts claimKeyFor.
  const norm = (v) => (v ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  for (const c of candidates) {
    const claimKey = [conflict.id, norm(c.locationName), c.changeType, norm(c.claimed.name)].join("|");
    const existing = await prisma.territorialChangeCandidate.findFirst({
      where: { conflictId: conflict.id, locationName: c.locationName, sourceUrl: IISS_URL },
    });
    if (existing) {
      // Backfill the Territorial Change Intelligence fields on earlier seeds.
      if (!existing.claimKey) {
        await prisma.territorialChangeCandidate.update({ where: { id: existing.id }, data: { claimKey, changeType: c.changeType } });
      }
      continue;
    }
    await prisma.territorialChangeCandidate.create({
      data: {
        conflictId: conflict.id,
        description: c.description,
        changeType: c.changeType,
        // Secondary analysis of an ACLED-derived map: moderate, not certain.
        confidence: 0.5,
        claimKey,
        evidence: "seed: cited from IISS analysis (not a detected phrase)",
        claimedActorId: c.claimed.id,
        previousActorId: c.previous.id,
        locationName: c.locationName,
        lat: c.lat,
        lng: c.lng,
        precision: c.precision,
        sourceName: IISS_NAME,
        sourceUrl: IISS_URL,
        observedAt: c.observedAt,
      },
    });
  }

  // One illustrative Area of Operation: deliberately a coarse, hand-drawn
  // area-level box over Rakhine State (the analysis names Rakhine as the
  // Arakan Army's theatre) — NOT IISS geometry, and NOT a control claim.
  const aooName = "Rakhine State (area-level)";
  const hasAoo = await prisma.areaOfOperation.findFirst({ where: { unitId: aa.id, name: aooName } });
  if (!hasAoo) {
    await prisma.areaOfOperation.create({
      data: {
        unitId: aa.id,
        conflictId: conflict.id,
        name: aooName,
        description: "Coarse bounding area where the Arakan Army has demonstrated operational activity. Not a territorial-control claim.",
        geometry: JSON.stringify({
          type: "Polygon",
          coordinates: [[[92.2, 17.0], [94.8, 17.0], [94.8, 21.5], [92.2, 21.5], [92.2, 17.0]]],
        }),
        precision: "area_level",
        asOfDate: new Date("2025-08-01"),
        sourceName: IISS_NAME,
        sourceUrl: IISS_URL,
      },
    });
  }
  console.log("Seeded Myanmar reference data: 7 actors, 4 territorial-change candidates, 1 area of operation.");
}

// ---------------------------------------------------------------------------
// Global Conflict Registry (data/conflict-registry.json, data/actor-registry.json).
// Idempotent. Existing conflicts KEEP their name/severity/intensity/status/
// summary/legacy `countries`; the registry only adds geography (fighting vs
// participants vs supporters), classification, family, actor links, provenance
// and dedicated-source links — except entries flagged statusAudit, whose status
// is corrected because the record is a tension, not fighting. New conflicts are
// created in full. Candidate sources are stored only — nothing is fetched.
import { readFileSync } from "node:fs";

function severityForIntensity(n) {
  if (n < 30) return "stable";
  if (n < 50) return "guarded";
  if (n < 70) return "elevated";
  if (n < 80) return "high";
  if (n < 90) return "severe";
  return "extreme";
}

async function seedRegistry() {
  const registry = JSON.parse(readFileSync(new URL("../data/conflict-registry.json", import.meta.url), "utf8"));
  const actorRegistry = JSON.parse(readFileSync(new URL("../data/actor-registry.json", import.meta.url), "utf8"));
  const curatedAt = new Date(registry.curatedAt);

  const familyIds = new Map();
  for (const f of registry.families) {
    const row = await prisma.conflictFamily.upsert({
      where: { slug: f.slug },
      update: { name: f.name, description: f.description },
      create: { slug: f.slug, name: f.name, description: f.description },
    });
    familyIds.set(f.slug, row.id);
  }

  const norm = (v) => v.toLowerCase().replace(/[’‘`]/g, "'").replace(/^the\s+/, "").replace(/\s+/g, " ").trim();
  const actorByName = new Map();
  for (const a of actorRegistry.actors) {
    actorByName.set(norm(a.canonical), a);
    for (const al of a.aliases) actorByName.set(norm(typeof al === "string" ? al : al.alias), a);
  }

  async function findOrCreateUnit(name, conflictId) {
    const entry = actorByName.get(norm(name));
    const canonical = entry ? entry.canonical : name;
    const variants = entry ? [entry.canonical, ...entry.aliases.map((al) => (typeof al === "string" ? al : al.alias))] : [name];
    const all = await prisma.militaryUnit.findMany({ select: { id: true, name: true } });
    const found =
      all.find((u) => u.name === canonical) ?? all.find((u) => variants.some((v) => norm(v) === norm(u.name)));
    if (found) return found;
    return prisma.militaryUnit.create({
      data: {
        name: canonical,
        unitType: entry && entry.kind === "state" ? "State military" : entry && entry.kind === "organization" ? "Organization" : "Armed group",
        status: "active",
        primaryConflictId: conflictId,
        sourceName: "Global Conflict Registry",
      },
    });
  }

  let created = 0;
  for (const e of registry.conflicts) {
    const registryFields = {
      fullScaleWar: e.fullScaleWar,
      fightingCountries: JSON.stringify(e.fightingCountries),
      participantCountries: JSON.stringify(e.participantCountries),
      supporterCountries: JSON.stringify(e.supporterCountries),
      regions: JSON.stringify(e.regions),
      geographyBasis: "curated",
      classificationConfidence: e.classification.confidence,
      classificationNote: e.classification.note,
      familyId: e.familySlug ? familyIds.get(e.familySlug) : null,
      curatedAt,
    };
    let conflict = await prisma.conflict.findUnique({ where: { slug: e.slug } });
    if (conflict) {
      const update = { ...registryFields };
      if (e.statusAudit && e.status) update.status = e.status;
      if (!conflict.startedAt && e.startedAt) update.startedAt = new Date(e.startedAt);
      conflict = await prisma.conflict.update({ where: { slug: e.slug }, data: update });
    } else {
      const intensity = e.intensity ?? 40;
      conflict = await prisma.conflict.create({
        data: {
          slug: e.slug,
          name: e.name,
          shortName: e.shortName,
          region: e.region,
          status: e.status ?? "active",
          severity: e.severity ?? severityForIntensity(intensity),
          intensity,
          intensityChange24h: 0,
          startedAt: e.startedAt ? new Date(e.startedAt) : null,
          lat: e.lat ?? null,
          lng: e.lng ?? null,
          primaryEffects: JSON.stringify(e.primaryEffects ?? ["Security"]),
          summary: e.summary ?? null,
          ...registryFields,
        },
      });
      created += 1;
    }

    for (const link of e.actors) {
      const unit = await findOrCreateUnit(link.name, conflict.id);
      await prisma.conflictParticipant.upsert({
        where: { conflictId_unitId: { conflictId: conflict.id, unitId: unit.id } },
        update: { role: link.role },
        create: { conflictId: conflict.id, unitId: unit.id, role: link.role },
      });
    }

    const fields = ["status", "fightingCountries", "participantCountries", "supporterCountries", "classification", "fullScaleWar"];
    if (e.startedAt) fields.push("startedAt");
    for (const field of fields) {
      for (const tracker of registry.trackers.filter((t) => t.covers.includes(field))) {
        await prisma.conflictMetadataSource.upsert({
          where: { conflictId_field_sourceName: { conflictId: conflict.id, field, sourceName: tracker.name } },
          update: { sourceUrl: tracker.url, retrievedAt: curatedAt },
          create: {
            conflictId: conflict.id,
            field,
            sourceName: tracker.name,
            sourceUrl: tracker.url,
            note: field === "classification" ? e.classification.note : "Curated registry entry — consult the tracker for current detail.",
            retrievedAt: curatedAt,
          },
        });
      }
    }

    for (const sourceName of e.dedicatedSources ?? []) {
      const source = await prisma.source.findFirst({ where: { name: sourceName } });
      if (!source) continue;
      await prisma.sourceConflictLink.upsert({
        where: { sourceId_conflictId: { sourceId: source.id, conflictId: conflict.id } },
        update: { scope: "dedicated" },
        create: { sourceId: source.id, conflictId: conflict.id, scope: "dedicated" },
      });
    }
  }

  for (const c of registry.sourceCandidates) {
    const conflict = await prisma.conflict.findUnique({ where: { slug: c.conflictSlug } });
    if (!conflict) continue;
    const existing = await prisma.sourceCandidate.findFirst({ where: { conflictId: conflict.id, name: c.name } });
    if (existing) continue;
    await prisma.sourceCandidate.create({
      data: {
        name: c.name,
        url: c.url,
        conflictId: conflict.id,
        sourceType: c.sourceType,
        language: c.language,
        status: "candidate",
        notes: "Suggested during the registry audit. RSS/API availability and reuse terms are unverified; nothing is fetched or scraped.",
      },
    });
  }
  console.log(`Seeded conflict registry: ${registry.conflicts.length} entries (${created} new), ${registry.sourceCandidates.length} candidate sources.`);
}

// ---------------------------------------------------------------------------
// Coverage-Driven Source Expansion (data/source-expansion.json). Idempotent:
// sources are matched by feed URL / Telegram handle (never duplicated), an
// existing source's operational state (enabled, health, timestamps) is never
// touched, and candidate-source statuses are only advanced from "candidate".
async function seedSourceExpansion() {
  const expansion = JSON.parse(readFileSync(new URL("../data/source-expansion.json", import.meta.url), "utf8"));
  let created = 0;
  for (const s of expansion.sources) {
    const where = s.type === "telegram" ? { telegramHandle: s.telegramHandle } : { url: s.url };
    let source = await prisma.source.findFirst({ where });
    // Descriptive fields only. The name is set on create and never rewritten: an
    // existing source with the same feed URL (e.g. from the base list) keeps its
    // name, so the base seeder's by-name upsert can never create a duplicate.
    const descriptive = {
      language: s.language ?? null,
      country: s.country ?? null,
      sourceCategory: s.sourceCategory ?? null,
      sourceRole: s.sourceRole,
      reliabilityTier: s.reliabilityTier ?? (s.sourceRole === "specialist_research" ? "B" : "B"),
    };
    if (source) {
      source = await prisma.source.update({ where: { id: source.id }, data: descriptive });
    } else {
      source = await prisma.source.create({
        data: {
          ...descriptive,
          name: s.name,
          type: s.type,
          url: s.url ?? null,
          telegramHandle: s.telegramHandle ?? null,
          permissionStatus: s.permissionStatus ?? "authorized",
          enabled: s.enabled ?? true,
          autoIngest: s.autoIngest ?? true,
          autoProcessing: true,
          pollIntervalMinutes: s.pollIntervalMinutes ?? (s.sourceRole === "specialist_research" ? 60 : 30),
        },
      });
      created += 1;
    }
    for (const link of s.links ?? []) {
      const conflict = await prisma.conflict.findUnique({ where: { slug: link.conflict } });
      if (!conflict) continue;
      await prisma.sourceConflictLink.upsert({
        where: { sourceId_conflictId: { sourceId: source.id, conflictId: conflict.id } },
        update: { scope: link.scope },
        create: { sourceId: source.id, conflictId: conflict.id, scope: link.scope, note: s.note ?? null },
      });
    }
  }
  for (const u of expansion.candidateUpdates) {
    const rows = await prisma.sourceCandidate.findMany({ where: { name: u.name, status: "candidate" } });
    for (const row of rows) {
      await prisma.sourceCandidate.update({ where: { id: row.id }, data: { status: u.status, ...(u.notes ? { notes: u.notes } : {}) } });
    }
  }
  console.log(`Seeded source expansion: ${expansion.sources.length} sources (${created} new).`);
}

/** Identity fields that follow directly from what a row already says (no guessing): an rss
 * source's url is its feed; a telegram source's handle gives its platform/handle/profile URL. */
async function backfillSourceIdentity() {
  const rows = await prisma.source.findMany({ where: { platform: null } });
  for (const r of rows) {
    const data = { platform: r.type };
    if (r.type === "rss" && r.url && !r.feedUrl) data.feedUrl = r.url;
    if (r.telegramHandle) {
      const handle = r.telegramHandle.replace(/^@/, "");
      data.platformHandle = handle;
      if (r.type === "telegram") data.socialProfileUrl = `https://t.me/${handle}`;
    }
    await prisma.source.update({ where: { id: r.id }, data });
  }
}

async function main() {
  for (const source of sources) {
    const existing = await prisma.source.findFirst({ where: { name: source.name } });
    if (existing) {
      await prisma.source.update({ where: { id: existing.id }, data: source });
    } else {
      await prisma.source.create({ data: source });
    }
  }
  console.log(`Seeded ${sources.length} sources.`);

  for (const conflict of conflicts) {
    await prisma.conflict.upsert({
      where: { slug: conflict.slug },
      update: conflict,
      create: conflict,
    });
  }
  console.log(`Seeded ${conflicts.length} conflict(s).`);

  await seedMilitaryReference();
  await seedMyanmarReference();
  await seedRegistry();
  await seedSourceExpansion();
  await backfillSourceIdentity();
  await seedSourcePlugin(prisma);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
