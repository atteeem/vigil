#!/usr/bin/env node
// Runs ONLY the territorial dataset registry seed (prisma/seed-territorial-datasets.mjs) against DATABASE_URL, without
// re-running the full seed (which would re-upsert sources and conflicts). Loads imported geometry as unpublished drafts.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { seedTerritorialDatasets } from "../prisma/seed-territorial-datasets.mjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
seedTerritorialDatasets(prisma)
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
