// Prisma 7 config file — the CLI (generate/migrate) reads the datasource
// URL from here rather than from prisma/schema.prisma (which no longer
// accepts a `url` field). The runtime PrismaClient gets its connection via
// a driver adapter instead — see lib/db/client.ts.
//
// Two different connection strings, deliberately: DATABASE_URL (the app's
// own runtime connection, via the adapter in lib/db/client.ts) is Supabase's
// pooled Transaction Pooler URL, sized for many short-lived serverless-style
// connections. DIRECT_URL, used only here for the CLI (generate / migrate /
// studio), is Supabase's Session Pooler URL — migrations run DDL and take
// an advisory lock on the migrations table, which needs a real session-held
// connection rather than a transaction-pooled one.
import { defineConfig, env } from "prisma/config";
// Prisma 7's CLI no longer auto-loads .env before evaluating this config
// file, unlike earlier versions — load it explicitly so `npx prisma
// generate`/`migrate` work without having to export DIRECT_URL by hand.
import "dotenv/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DIRECT_URL"),
  },
});
