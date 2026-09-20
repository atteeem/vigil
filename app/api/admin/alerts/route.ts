import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { alertStats } from "@/lib/alerts/engine";
import { toNotificationDTO } from "@/lib/alerts/dto";

// Alert inspector: recent decisions (why a watcher did / did not get an alert), generated notifications
// with their triggering state, and the engine counters. Filter by decision or fingerprint.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const records = await prisma.alertRecord.findMany({
    where: { ...(p.get("decision") ? { decision: p.get("decision")! } : {}), ...(p.get("fingerprint") ? { fingerprint: { contains: p.get("fingerprint")! } } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(p.get("limit")) || 100, 500),
  });
  const notifications = await prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  const decisions = await prisma.alertRecord.groupBy({ by: ["decision"], _count: { _all: true } });
  const [watchers, watches] = await Promise.all([prisma.watcher.count(), prisma.watch.count()]);
  return NextResponse.json({
    stats: { ...alertStats, watchers, watches, decisions: Object.fromEntries(decisions.map((d) => [d.decision, d._count._all])) },
    records: records.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), detail: r.detail ? JSON.parse(r.detail) : null })),
    notifications: notifications.map(toNotificationDTO),
  });
}
