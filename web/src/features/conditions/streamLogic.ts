/** @author Tang Chee Seng (with assistance from Claude) */
import type { ConditionsSnapshot, LightningRiskPayload } from "@/api/conditionsStream";

export interface TrendPoint { observedAt: string; wbgt: number; }

export function nextBackoffDelay(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** attempt);
}

export const STALE_AFTER_MS = 40_000;

export function isConnectionStale(lastSnapshotAt: number | null, now: number): boolean {
  if (lastSnapshotAt === null) return false;
  return now - lastSnapshotAt > STALE_AFTER_MS;
}

export function appendTrendPoint(
  buffer: TrendPoint[], snapshot: ConditionsSnapshot, cap: number,
): TrendPoint[] {
  const c = snapshot.conditions;
  if (c === null) return buffer;
  const last = buffer.at(-1);
  if (last?.observedAt === c.observedAt) return buffer;
  return [...buffer, { observedAt: c.observedAt, wbgt: c.wbgt }].slice(-cap);
}

export function isStopWorkActive(lightning: LightningRiskPayload | null, now: number): boolean {
  if (lightning?.state !== "STOP_WORK") return false;
  return now < Date.parse(lightning.validUntil);
}