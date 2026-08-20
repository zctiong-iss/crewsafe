/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect } from "vitest";
import {
  nextBackoffDelay,
  isConnectionStale,
  bucketDispatches,
  STALE_AFTER_MS,
} from "./actionMonitoringLogic";
import type { ActionDispatch, ActionDispatchStatus } from "@/api/actionStatusStream";

const make = (status: ActionDispatchStatus, id: string = status): ActionDispatch => ({
  id,
  recommendationId: "r-1",
  approvalId: null,
  workerId: "w-1",
  actionCode: "HYDRATE",
  instruction: null,
  startTime: null,
  endTime: null,
  status,
  dispatchedAt: "2026-08-20T08:00:00Z",
  lateAt: null,
  completedBy: null,
});

describe("nextBackoffDelay", () => {
  it("doubles per attempt and caps at 30s", () => {
    expect(nextBackoffDelay(0)).toBe(1_000);
    expect(nextBackoffDelay(3)).toBe(8_000);
    expect(nextBackoffDelay(10)).toBe(30_000);
  });
});

describe("isConnectionStale", () => {
  it("is false before the first tick", () => {
    expect(isConnectionStale(null, 999_999)).toBe(false);
  });
  it("is false within the window, true past it", () => {
    const t = 1_000_000;
    expect(isConnectionStale(t, t + STALE_AFTER_MS - 1)).toBe(false);
    expect(isConnectionStale(t, t + STALE_AFTER_MS + 1)).toBe(true);
  });
});

describe("bucketDispatches", () => {
  it("groups each dispatch into its status bucket", () => {
    const buckets = bucketDispatches([
      make("PENDING"),
      make("LATE"),
      make("ACKNOWLEDGED"),
      make("COMPLETED"),
    ]);
    expect(buckets.pending).toHaveLength(1);
    expect(buckets.late).toHaveLength(1);
    expect(buckets.acknowledged).toHaveLength(1);
    expect(buckets.completed).toHaveLength(1);
  });

  it("excludes CANCELLED from every bucket, matching the counts", () => {
    const buckets = bucketDispatches([make("CANCELLED", "c-1"), make("PENDING", "p-1")]);
    expect(buckets.pending).toHaveLength(1);
    expect(buckets.late).toHaveLength(0);
    expect(buckets.acknowledged).toHaveLength(0);
    expect(buckets.completed).toHaveLength(0);
  });

  it("keeps multiple dispatches of the same status", () => {
    const buckets = bucketDispatches([make("PENDING", "p-1"), make("PENDING", "p-2")]);
    expect(buckets.pending.map((d) => d.id)).toEqual(["p-1", "p-2"]);
  });
});
