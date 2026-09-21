import { prisma } from "@/lib/db/client";

// Data revision for brief caching. It changes only when something a brief is built from changes in a way
// that can matter: published events (and their accepted history), state transitions, reviewed territorial
// records, conflict records, non-thermal structured events/revisions/claims, plus an in-process bump raised
// when the alert service sees a MATERIAL development (e.g. independent corroboration). A duplicate article
// attached to an existing event touches none of these, so it does not invalidate a cached brief.

const g = globalThis as unknown as { __vigilBriefBump?: number };
export const bumpBriefRevision = () => {
  g.__vigilBriefBump = (g.__vigilBriefBump ?? 0) + 1;
};
const ms = (d: Date | null | undefined) => (d ? d.getTime() : 0);

export async function dataRevision(): Promise<string> {
  const [ev, hist, tr, terr, conf, ge, rev, claims, links] = await Promise.all([
    prisma.event.aggregate({ where: { published: true }, _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.eventHistory.aggregate({ _count: { _all: true }, _max: { createdAt: true } }),
    prisma.stateTransition.aggregate({ _count: { _all: true }, _max: { at: true } }),
    prisma.territorialChangeCandidate.aggregate({ where: { status: { in: ["approved", "uncertain"] } }, _count: { _all: true }, _max: { reviewedAt: true } }),
    prisma.conflict.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.globalEvent.aggregate({ where: { category: { not: "thermal_detection" } }, _count: { _all: true }, _max: { firstSeenAt: true } }),
    prisma.globalEventRevision.aggregate({ _count: { _all: true }, _max: { recordedAt: true } }),
    prisma.globalEventClaim.aggregate({ _count: { _all: true }, _max: { createdAt: true } }),
    prisma.globalEventLink.aggregate({ where: { status: "confirmed" }, _count: { _all: true } }),
  ]);
  return [ev._count._all, ms(ev._max.updatedAt), hist._count._all, ms(hist._max.createdAt), tr._count._all, ms(tr._max.at), terr._count._all, ms(terr._max.reviewedAt), conf._count._all, ms(conf._max.updatedAt), ge._count._all, ms(ge._max.firstSeenAt), rev._count._all, ms(rev._max.recordedAt), claims._count._all, ms(claims._max.createdAt), links._count._all, g.__vigilBriefBump ?? 0].join(".");
}
