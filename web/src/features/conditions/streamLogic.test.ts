/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect } from "vitest";
import {
  nextBackoffDelay,
  isConnectionStale,
  appendTrendPoint,
  isStopWorkActive,
  mergeTrendPoints,
  STALE_AFTER_MS,
} from "./streamLogic";
import type { ConditionsSnapshot } from "@/api/conditionsStream";

const snap = (observedAt: string | null, wbgt = 31, asOf = observedAt ?? "2026-08-06T09:00:00Z"): ConditionsSnapshot => ({
  siteId: "s1", asOf, activeShift: null, lightning: null,
  conditions: observedAt === null ? null : {
    wbgt, currentBand: null, forecastBand: null, forecastWbgt30m: null,
    temperature: 33, humidity: 70, windSpeed: 2, rainfall: 0,
    observedAt, source: "NEA", freshness: "LIVE",
  },
});

describe("nextBackoffDelay", () => {
  it("doubles per attempt and caps at 30s", () => {
    expect(nextBackoffDelay(0)).toBe(1_000);
    expect(nextBackoffDelay(3)).toBe(8_000);
    expect(nextBackoffDelay(10)).toBe(30_000);
  });
});

describe("isConnectionStale", () => {
  it("is false before the first snapshot", () => {
    expect(isConnectionStale(null, 999_999)).toBe(false);
  });
  it("is false within the window, true past it", () => {
    const t = 1_000_000;
    expect(isConnectionStale(t, t + STALE_AFTER_MS - 1)).toBe(false);
    expect(isConnectionStale(t, t + STALE_AFTER_MS + 1)).toBe(true);
  });
});

describe("mergeTrendPoints", () => {
  it("sorts points, prunes outside four hours, and lets the newer source win on overlap", () => {
    const merged = mergeTrendPoints(
      [
        { observedAt: "2026-08-20T08:45:00Z", wbgt: 29.1 },
        { observedAt: "2026-08-20T04:59:59Z", wbgt: 25 },
        { observedAt: "2026-08-20T06:00:00Z", wbgt: 27.3 },
      ],
      [
        { observedAt: "2026-08-20T07:00:00Z", wbgt: 28 },
        { observedAt: "2026-08-20T06:00:00Z", wbgt: 31.2 },
      ],
      "2026-08-20T09:00:00Z",
    );

    expect(merged).toEqual([
      { observedAt: "2026-08-20T06:00:00Z", wbgt: 31.2 },
      { observedAt: "2026-08-20T07:00:00Z", wbgt: 28 },
      { observedAt: "2026-08-20T08:45:00Z", wbgt: 29.1 },
    ]);
  });

  it("keeps every point in the time window instead of applying the former 60-point cap", () => {
    const points = Array.from({ length: 70 }, (_, index) => ({
      observedAt: new Date(Date.parse("2026-08-20T05:01:00Z") + index * 180_000).toISOString(),
      wbgt: 27 + index / 100,
    }));

    expect(mergeTrendPoints([], points, "2026-08-20T09:00:00Z")).toHaveLength(70);
  });
});

describe("appendTrendPoint", () => {
  it("deduplicates live observations and prunes against the snapshot server time", () => {
    let buffer = [
      { observedAt: "2026-08-20T04:59:59Z", wbgt: 25 },
      { observedAt: "2026-08-20T08:45:00Z", wbgt: 29 },
    ];

    buffer = appendTrendPoint(
      buffer,
      snap("2026-08-20T08:45:00Z", 30, "2026-08-20T09:00:00Z"),
    );

    expect(buffer).toEqual([
      { observedAt: "2026-08-20T08:45:00Z", wbgt: 30 },
    ]);
  });

  it("ignores a null conditions payload", () => {
    expect(appendTrendPoint([], snap(null))).toEqual([]);
  });
});

describe("isStopWorkActive", () => {
  const lightning = (state: string, validUntil: string) => ({
    state: state as "CLEAR" | "ADVISORY" | "STOP_WORK",
    nearestStrikeKm: 5,
    observedAt: "2026-08-06T07:40:00Z",
    validUntil,
    freshness: "LIVE" as const,
  });

  it("is true for STOP_WORK before validUntil", () => {
    expect(isStopWorkActive(lightning("STOP_WORK", "2026-08-06T08:00:00Z"), Date.parse("2026-08-06T07:50:00Z"))).toBe(true);
  });
  it("is false for ADVISORY", () => {
    expect(isStopWorkActive(lightning("ADVISORY", "2026-08-06T08:00:00Z"), Date.parse("2026-08-06T07:50:00Z"))).toBe(false);
  });
  it("is false for CLEAR", () => {
    expect(isStopWorkActive(lightning("CLEAR", "2026-08-06T08:00:00Z"), Date.parse("2026-08-06T07:50:00Z"))).toBe(false);
  });
  it("is false at or after validUntil", () => {
    expect(isStopWorkActive(lightning("STOP_WORK", "2026-08-06T08:00:00Z"), Date.parse("2026-08-06T08:00:00Z"))).toBe(false);
    expect(isStopWorkActive(lightning("STOP_WORK", "2026-08-06T08:00:00Z"), Date.parse("2026-08-06T08:01:00Z"))).toBe(false);
  });
  it("is false when lightning is null", () => {
    expect(isStopWorkActive(null, Date.now())).toBe(false);
  });
});
