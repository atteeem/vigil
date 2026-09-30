import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7's driver-adapter model: the runtime client connects via an
// explicit adapter instead of reading a connection string out of
// schema.prisma. PrismaPg takes a standard Postgres connection string
// (the Supabase Session Pooler URL, port 5432) directly as `connectionString`.
function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

// Standard Next.js dev-mode singleton: without this, every hot-reload of a
// module that imports this file would open a fresh PrismaClient (and a
// fresh Postgres connection pool) on top of the last one.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
