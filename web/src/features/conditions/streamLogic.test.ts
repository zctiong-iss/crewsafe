/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect } from "vitest";
import { nextBackoffDelay, isConnectionStale, appendTrendPoint, isStopWorkActive, STALE_AFTER_MS } from "./streamLogic";
import type { ConditionsSnapshot } from "@/api/conditionsStream";

const snap = (observedAt: string | null, wbgt = 31): ConditionsSnapshot => ({
  siteId: "s1", asOf: "2026-08-06T00:00:00Z", activeShift: null, lightning: null,
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

describe("appendTrendPoint", () => {
  it("dedupes consecutive identical observations", () => {
    let buf = appendTrendPoint([], snap("2026-08-06T07:40:00Z", 31), 60);
    buf = appendTrendPoint(buf, snap("2026-08-06T07:40:00Z", 31), 60);
    expect(buf).toHaveLength(1);
    buf = appendTrendPoint(buf, snap("2026-08-06T07:55:00Z", 32), 60);
    expect(buf).toHaveLength(2);
  });
  it("ignores null conditions and respects the cap", () => {
    expect(appendTrendPoint([], snap(null), 60)).toHaveLength(0);
    let buf: ReturnType<typeof appendTrendPoint> = [];
    for (let i = 0; i < 70; i++)
      buf = appendTrendPoint(buf, snap(`2026-08-06T00:${String(i).padStart(2, "0")}:00Z`), 60);
    expect(buf).toHaveLength(60);
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