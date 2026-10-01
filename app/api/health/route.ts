import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getSchedulerState } from "@/lib/ingestion/scheduler";

export const dynamic = "force-dynamic";

// Deployment health check (Railway et al.): confirms the process is serving requests AND the database
// connection actually works, without leaking anything about how — no connection string, no host, no
// table/row data, no stack trace. A failed DB check is a generic 503; the real error only goes to the
// server's own logs, never the response body.
//
// The scheduler block reports only timestamps, counts and a short sanitized error message (see
// lib/ingestion/scheduler.ts's SchedulerState) — enough to tell "never started" (started: false) apart
// from "started but has gone quiet" (started: true, lastTickAgeSeconds far beyond the tick interval)
// from "ticking normally" (started: true, lastTickAgeSeconds small), without exposing which sources
// exist or anything about them.
export async function GET() {
  const scheduler = getSchedulerState();
  const lastTickAt = scheduler.lastTickFinishedAt ?? scheduler.lastTickStartedAt;
  const lastTickAgeSeconds = lastTickAt ? Math.round((Date.now() - new Date(lastTickAt).getTime()) / 1000) : null;

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      database: "ok",
      scheduler: {
        started: scheduler.startedAt !== null,
        startedAt: scheduler.startedAt,
        lastTickAt,
        lastTickAgeSeconds,
        lastTickResult: scheduler.lastTickResult,
        lastTickError: scheduler.lastTickError,
      },
    });
  } catch (err) {
    console.error("[health] database connectivity check failed:", err);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
