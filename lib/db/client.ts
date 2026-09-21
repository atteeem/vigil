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
  const client = new PrismaClient({ adapter });
  // better-sqlite3 runs every query synchronously on the Node main thread, so a commit's fsync stalls the whole
  // server (page requests included). SQLite's default rollback journal + synchronous=FULL costs several fsyncs per
  // write transaction; on a slow disk the ingestion pass alone blocked the event loop for 15-30 s at a time
  // (measured: ~28 s to store 42 items, ~0.3 s after this change). WAL needs one sequential append per commit and
  // synchronous=NORMAL syncs only at checkpoints (durable across an application crash; a power cut can lose the
  // last few commits, never corrupt the database). WAL is persistent in the file; synchronous is per connection.
  void client
    .$queryRawUnsafe("PRAGMA journal_mode = WAL")
    .then(() => client.$queryRawUnsafe("PRAGMA synchronous = NORMAL"))
    .catch((err) => console.warn("[db] could not switch SQLite to WAL / synchronous=NORMAL:", err));
  return client;
}

// Standard Next.js dev-mode singleton: without this, every hot-reload of a
// module that imports this file would open a fresh PrismaClient (and a
// fresh SQLite connection) on top of the last one.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
