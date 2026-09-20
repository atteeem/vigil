import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { HAZARD_PROVIDERS, missingCredentials } from "@/lib/hazards/registry";

// Admin coverage for the structured providers: status, health, backoff, event counts, access needs.
export const dynamic = "force-dynamic";

export async function GET() {
  const now = Date.now();
  const sources = await prisma.source.findMany({ where: { type: "structured" }, orderBy: { name: "asc" } });
  const counts = await prisma.globalEvent.groupBy({ by: ["provider"], _count: { _all: true } });
  const active = await prisma.globalEvent.groupBy({ by: ["provider"], where: { endedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, _count: { _all: true } });
  const total = new Map(counts.map((c) => [c.provider, c._count._all]));
  const live = new Map(active.map((c) => [c.provider, c._count._all]));

  return NextResponse.json(
    sources.map((s) => {
      const provider = s.platform ? HAZARD_PROVIDERS[s.platform] : undefined;
      const missing = provider ? missingCredentials(provider) : [];
      const last = s.lastSuccessfulIngestion?.getTime() ?? null;
      const interval = s.pollIntervalMinutes * 60_000;
      const backingOff = s.consecutiveFailures > 0 && !!s.nextPollAt && s.nextPollAt.getTime() > now;
      const stale = s.enabled && missing.length === 0 && (last === null || now - last > interval * 3);
      return {
        id: s.id,
        name: s.name,
        provider: s.platform,
        layer: provider?.layer ?? null,
        enabled: s.enabled,
        pollIntervalMinutes: s.pollIntervalMinutes,
        lastSuccessAt: s.lastSuccessfulIngestion?.toISOString() ?? null,
        lastAttemptedAt: s.lastAttemptedAt?.toISOString() ?? null,
        lastError: s.lastError,
        consecutiveFailures: s.consecutiveFailures,
        nextPollAt: s.nextPollAt?.toISOString() ?? null,
        backingOff,
        stale,
        health: !s.enabled ? "disabled" : missing.length ? "needs_credentials" : backingOff ? "backing_off" : stale ? "stale" : s.lastError ? "error" : last ? "ok" : "never_run",
        access: provider?.credentials ? { requiresCredentials: true, env: provider.credentials.env, missing, signup: provider.credentials.signup } : { requiresCredentials: false, env: [], missing: [], signup: null },
        events: { total: total.get(s.platform ?? "") ?? 0, active: live.get(s.platform ?? "") ?? 0 },
        trustClass: s.independenceClass,
        notes: s.verificationNotes,
        url: s.feedUrl ?? s.url,
      };
    }),
  );
}
