import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// Prisma 7's driver-adapter model: the runtime client connects via an
// explicit adapter instead of reading a connection string out of
// schema.prisma. better-sqlite3 takes a plain filesystem path, not the
// `file:` URI scheme Prisma's own config file uses — strip that prefix.
function sqlitePath(databaseUrl: string): string {
  return databaseUrl.replace(/^file:/, "");
}

function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({ url: sqlitePath(process.env.DATABASE_URL ?? "file:./prisma/dev.db") });
  return new PrismaClient({ adapter });
}

// Standard Next.js dev-mode singleton: without this, every hot-reload of a
// module that imports this file would open a fresh PrismaClient (and a
// fresh SQLite connection) on top of the last one.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
