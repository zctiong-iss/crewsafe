/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect } from "vitest";
import { assessFreshness } from "./freshness";
import type { LatestWeather } from "@/api/weather";

const reading = (over: Partial<LatestWeather>): LatestWeather => ({
  id: "w-1", siteId: "site-1",
  wbgt: 31, temperature: 33, humidity: 70, windSpeed: 5, rainfall: 0,
  observedAt: new Date().toISOString(), ingestedAt: new Date().toISOString(),
  source: "NEA", qualityStatus: "LIVE", ...over,
});
const NOW = new Date("2026-08-04T12:00:00Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

describe("assessFreshness", () => {
  it("is fresh within the delayed threshold", () => {
    expect(assessFreshness(reading({ observedAt: minsAgo(3) }), NOW).level).toBe("fresh");
  });
  it("is delayed between 20 and 45 minutes", () => {
    expect(assessFreshness(reading({ observedAt: minsAgo(30) }), NOW).level).toBe("delayed");
  });
  it("is stale past 45 minutes", () => {
    expect(assessFreshness(reading({ observedAt: minsAgo(50) }), NOW).level).toBe("stale");
  });
  it("trusts the server: STALE overrides a recent timestamp", () => {
    expect(
      assessFreshness(reading({ observedAt: minsAgo(1), qualityStatus: "STALE" }), NOW).level,
    ).toBe("stale");
  });

  // SCRUM-420 / S3358 — exact boundary values, locking in the `>=` comparison semantics
  // before the nested ternary is extracted to levelForAge().
  it("is delayed at exactly the 20-minute boundary (>=, not >)", () => {
    expect(assessFreshness(reading({ observedAt: minsAgo(20) }), NOW).level).toBe("delayed");
  });
  it("is fresh one second inside the 20-minute boundary", () => {
    expect(
      assessFreshness(reading({ observedAt: new Date(NOW.getTime() - (20 * 60 - 1) * 1000).toISOString() }), NOW)
        .level,
    ).toBe("fresh");
  });
  it("is stale at exactly the 45-minute boundary (>=, not >)", () => {
    expect(assessFreshness(reading({ observedAt: minsAgo(45) }), NOW).level).toBe("stale");
  });
  it("is delayed one second inside the 45-minute boundary", () => {
    expect(
      assessFreshness(reading({ observedAt: new Date(NOW.getTime() - (45 * 60 - 1) * 1000).toISOString() }), NOW)
        .level,
    ).toBe("delayed");
  });
});