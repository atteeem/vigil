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
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
