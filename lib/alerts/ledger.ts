import { prisma } from "@/lib/db/client";

// The underlying state ledger. "closed -> closed" is not a change; "closed -> reopened -> closed" is two.
// `version` bumps on every MATERIAL change and is part of the alert fingerprint, so a repeat of a state
// already announced can never produce a second notification, while a genuine new state always can.

export interface LedgerPrev {
  state: string;
  value: number | null;
  data: Record<string, unknown> | null;
  version: number;
}
export interface StepResult {
  isNew: boolean;
  /** A material change (or first sighting): a development should be raised at `version`. */
  changed: boolean;
  prev: LedgerPrev | null;
  version: number;
}

export interface StepArgs {
  kind: string;
  key: string;
  alertType: string;
  state: string;
  value?: number | null;
  data?: Record<string, unknown> | null;
  /** false = read-only (simulation): nothing is written. */
  commit: boolean;
  /** Simulation: report the current state as a development regardless of what was announced before. */
  force?: boolean;
  /** Decides whether a differing state is worth announcing. Default: any difference. */
  material?: (prev: LedgerPrev) => boolean;
  /** First sighting is only a baseline (no development), e.g. a chokepoint that is simply normal. */
  baselineOnly?: boolean;
}

export interface TransitionInput {
  kind: string;
  key: string;
  alertType: string;
  fromState: string | null;
  toState: string;
  fromValue?: number | null;
  toValue?: number | null;
  material: boolean;
  data?: Record<string, unknown> | null;
  at?: Date;
}
export async function recordTransition(t: TransitionInput): Promise<void> {
  try {
    await prisma.stateTransition.create({ data: { kind: t.kind, key: t.key, alertType: t.alertType, fromState: t.fromState, toState: t.toState, fromValue: t.fromValue ?? null, toValue: t.toValue ?? null, material: t.material, data: t.data ? JSON.stringify(t.data) : null, ...(t.at ? { at: t.at } : {}) } });
  } catch (err) {
    console.error("[alerts] transition record failed:", err);
  }
}

export async function stepLedger(a: StepArgs): Promise<StepResult> {
  const row = await prisma.alertState.findUnique({ where: { kind_key_alertType: { kind: a.kind, key: a.key, alertType: a.alertType } } });
  const data = a.data ? JSON.stringify(a.data) : null;
  if (a.force) return { isNew: !row, changed: true, prev: row ? { state: row.state, value: row.value, data: row.data ? (JSON.parse(row.data) as Record<string, unknown>) : null, version: row.version } : null, version: row?.version ?? 1 };
  if (!row) {
    if (a.commit) await prisma.alertState.create({ data: { kind: a.kind, key: a.key, alertType: a.alertType, state: a.state, value: a.value ?? null, data, version: 1 } });
    return { isNew: true, changed: !a.baselineOnly, prev: null, version: 1 };
  }
  const prev: LedgerPrev = { state: row.state, value: row.value, data: row.data ? (JSON.parse(row.data) as Record<string, unknown>) : null, version: row.version };
  const differs = row.state !== a.state;
  const changed = differs && (a.material ? a.material(prev) : true);
  const version = changed ? row.version + 1 : row.version;
  if (a.commit && (differs || row.value !== (a.value ?? null))) {
    // A non-material difference is recorded silently so the next comparison is against what was last seen.
    await prisma.alertState.update({ where: { id: row.id }, data: { state: a.state, value: a.value ?? null, data, version } });
  }
  // Briefings need old -> new history for windows ("what changed between T0 and T1"): every real state
  // change is also appended to the transition ledger (no other side effects, never blocks the write).
  if (a.commit && differs) await recordTransition({ kind: a.kind, key: a.key, alertType: a.alertType, fromState: prev.state, toState: a.state, fromValue: prev.value, toValue: a.value ?? null, material: changed, data: a.data ?? null });
  return { isNew: false, changed, prev, version };
}
