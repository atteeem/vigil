import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

// Deployment health check (Railway et al.): confirms the process is serving requests AND the database
// connection actually works, without leaking anything about how — no connection string, no host, no
// table/row data, no stack trace. A failed DB check is a generic 503; the real error only goes to the
// server's own logs, never the response body.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error("[health] database connectivity check failed:", err);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
