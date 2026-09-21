import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/db/client";
import { schedulerTick } from "@/lib/ingestion/scheduler";

// The database runs synchronously on the server's only thread (better-sqlite3), so its durability settings decide
// whether ingestion can stall page requests. Regression guards for the local-performance diagnosis.

test.describe("database and scheduler settings", () => {
  test("SQLite uses WAL with synchronous=NORMAL", async () => {
    await prisma.$queryRawUnsafe("SELECT 1");
    // The pragma statements are issued when the client is created; give them a moment to complete.
    await expect
      .poll(async () => {
        const mode = (await prisma.$queryRawUnsafe<{ journal_mode: string }[]>("PRAGMA journal_mode"))[0]?.journal_mode;
        const sync = (await prisma.$queryRawUnsafe<{ synchronous: number | bigint }[]>("PRAGMA synchronous"))[0]?.synchronous;
        return `${mode}/${Number(sync)}`;
      })
      .toBe("wal/1");
  });

  test("a scheduler tick restricted to no sources polls nothing and reports nothing in flight", async () => {
    const r = await schedulerTick(new Date(), []);
    expect(r).toEqual({ due: 0, polled: 0, skippedInFlight: 0 });
  });
});
