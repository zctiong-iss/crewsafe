/** @author Tang Chee Seng (with assistance from Claude) */
import type { ActionDispatch } from "@/api/actionStatusStream";

// These three mirror conditions/streamLogic rather than importing it: the staleness/backoff
// semantics are shared transport behaviour, but coupling one feature to another feature's
// internals is a worse trade than four lines of parallel, independently-tested code.
export function nextBackoffDelay(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** attempt);
}

export const STALE_AFTER_MS = 40_000;

export function isConnectionStale(lastTickAt: number | null, now: number): boolean {
  if (lastTickAt === null) return false;
  return now - lastTickAt > STALE_AFTER_MS;
}

/** The four buckets the panel renders, in dispatch-lifecycle order. */
export interface DispatchBuckets {
  pending: ActionDispatch[];
  late: ActionDispatch[];
  acknowledged: ActionDispatch[];
  completed: ActionDispatch[];
}

/**
 * Splits a tick's dispatches into the four display buckets.
 *
 * CANCELLED dispatches are dropped: they are not shown on the board and the server excludes
 * them from the alert counts too, so keeping them here would desync the buckets from the
 * numbers above them.
 */
export function bucketDispatches(dispatches: readonly ActionDispatch[]): DispatchBuckets {
  const buckets: DispatchBuckets = { pending: [], late: [], acknowledged: [], completed: [] };
  for (const dispatch of dispatches) {
    switch (dispatch.status) {
      case "PENDING":
        buckets.pending.push(dispatch);
        break;
      case "LATE":
        buckets.late.push(dispatch);
        break;
      case "ACKNOWLEDGED":
        buckets.acknowledged.push(dispatch);
        break;
      case "COMPLETED":
        buckets.completed.push(dispatch);
        break;
      case "CANCELLED":
        break; // intentionally not displayed
    }
  }
  return buckets;
}
