// Prisma 7 config file — the CLI (generate/migrate) reads the datasource
// URL from here rather than from prisma/schema.prisma (which no longer
// accepts a `url` field). The runtime PrismaClient gets its connection via
// a driver adapter instead — see lib/db/client.ts.
import { defineConfig, env } from "prisma/config";
// Prisma 7's CLI no longer auto-loads .env before evaluating this config
// file, unlike earlier versions — load it explicitly so `npx prisma
// generate`/`migrate` work without having to export DATABASE_URL by hand.
import "dotenv/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
