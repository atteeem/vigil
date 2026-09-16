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

// Minimum conflict-assignment support for the ingestion proof (spec §5) —
// matches lib/data/mock-conflicts.ts's russia-ukraine entry so the two
// stay recognizable as "the same conflict" even though they're on
// different sides of the mock/DB boundary for now.
const conflicts = [
  {
    slug: "russia-ukraine",
    name: "Russia–Ukraine War",
    region: "Europe",
    status: "active",
    severity: "severe",
    intensity: 88,
    intensityChange24h: 4,
    startedAt: new Date("2022-02-24"),
    lat: 48.5,
    lng: 37.0,
    primaryEffects: JSON.stringify(["Security", "Trade", "Energy"]),
    summary:
      "Large-scale conventional war along a shifting front line in eastern and southern Ukraine, with sustained long-range strikes on infrastructure on both sides.",
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
