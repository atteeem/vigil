#!/usr/bin/env node
// Runs ONLY the territorial dataset registry seed (prisma/seed-territorial-datasets.mjs) against DATABASE_URL, without
// re-running the full seed (which would re-upsert sources and conflicts). Loads imported geometry as unpublished drafts.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
import { seedTerritorialDatasets } from "../prisma/seed-territorial-datasets.mjs";

// .env then .env.local (overriding), without ever overriding a variable the calling process
// already set for real — see prisma/seed.mjs's own comment for why.
const preExistingEnv = { ...process.env };
loadEnv();
loadEnv({ path: ".env.local", override: true });
Object.assign(process.env, preExistingEnv);
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
seedTerritorialDatasets(prisma)
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
