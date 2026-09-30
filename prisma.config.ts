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
// dotenv's default config() only reads .env, not .env.local — load both,
// same precedence Next.js itself uses (.env.local overrides .env), since
// real secrets (DIRECT_URL included) live in the gitignored .env.local.
// Neither file may override a variable the CALLING process already set for
// real (e.g. playwright.config.ts's webServer explicitly exports DATABASE_URL
// for the disposable test DB when it spawns `prisma migrate deploy`) — snapshot
// first, load both files, then restore anything that was already real.
import { config as loadEnv } from "dotenv";
const preExistingEnv = { ...process.env };
loadEnv();
loadEnv({ path: ".env.local", override: true });
Object.assign(process.env, preExistingEnv);

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DIRECT_URL"),
  },
});
