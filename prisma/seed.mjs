// Seeds the initial Source Manager registry entries per Telegram
// Sources.md in the Obsidian vault (D:\GLOBAL CONFLICT CLAUDE\Telegram
// Sources.md). Idempotent (upsert on name) so it's safe to re-run.
// Plain .mjs (not .ts) so it runs with a bare `node prisma/seed.mjs` —
// no ts-node/tsx dependency needed for a one-off local setup script.
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

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
    reliabilityTier: "community",
    permissionStatus: "unauthorized",
    enabled: false,
    autoIngest: false,
  },
  // First real external-source ingestion proof (RSS -> raw item -> admin
  // review -> publish -> /world). See ARCHITECTURE.md "Source ingestion
  // pipeline". auto_publish is NOT a field on Source — nothing here (or
  // anywhere in the ingestion pipeline) auto-publishes; publish is always
  // a human action in /admin/incoming.
  {
    name: "BBC World",
    type: "rss",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    language: "en",
    sourceCategory: "News",
    reliabilityTier: "A",
    permissionStatus: "authorized",
    enabled: true,
    autoIngest: true,
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
