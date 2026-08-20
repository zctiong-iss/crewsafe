/** @author Tang Chee Seng (with assistance from Claude) */
import type { ConditionsSnapshot, LightningRiskPayload } from "@/api/conditionsStream";

export interface TrendPoint { observedAt: string; wbgt: number; }

export const TREND_WINDOW_MS = 4 * 60 * 60 * 1_000;

export function nextBackoffDelay(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** attempt);
}

export const STALE_AFTER_MS = 40_000;

export function isConnectionStale(lastSnapshotAt: number | null, now: number): boolean {
  if (lastSnapshotAt === null) return false;
  return now - lastSnapshotAt > STALE_AFTER_MS;
}

export function mergeTrendPoints(
  existing: readonly TrendPoint[],
  incoming: readonly TrendPoint[],
  asOf: string,
): TrendPoint[] {
  const windowEnd = Date.parse(asOf);
  if (!Number.isFinite(windowEnd)) return [...existing];

  const windowStart = windowEnd - TREND_WINDOW_MS;
  const pointsByTime = new Map<string, TrendPoint>();
  for (const point of [...existing, ...incoming]) {
    const observedAt = Date.parse(point.observedAt);
    if (observedAt >= windowStart && observedAt <= windowEnd) {
      pointsByTime.set(point.observedAt, point);
    }
  }

  return [...pointsByTime.values()].sort(
    (left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt),
  );
}

export function appendTrendPoint(
  buffer: TrendPoint[], snapshot: ConditionsSnapshot,
): TrendPoint[] {
  const c = snapshot.conditions;
  const incoming = c === null ? [] : [{ observedAt: c.observedAt, wbgt: c.wbgt }];
  return mergeTrendPoints(buffer, incoming, snapshot.asOf);
}

export function isStopWorkActive(lightning: LightningRiskPayload | null, now: number): boolean {
  if (lightning?.state !== "STOP_WORK") return false;
  return now < Date.parse(lightning.validUntil);
}
