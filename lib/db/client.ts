import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7's driver-adapter model: the runtime client connects via an
// explicit adapter instead of reading a connection string out of
// schema.prisma. PrismaPg takes a standard Postgres connection string —
// Supabase's pooled Transaction Pooler URL, sized for many short-lived
// serverless-style connections (migrations use DIRECT_URL instead, via
// prisma.config.ts, since they need a real session-held connection —
// see that file's own comment). @prisma/adapter-pg issues unnamed
// prepared statements by default (no statementNameGenerator configured),
// which is what makes it safe to use under transaction-mode pooling.
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
