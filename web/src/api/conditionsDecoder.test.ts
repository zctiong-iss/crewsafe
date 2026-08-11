import { describe, expect, it } from "vitest";
import {
  decodeConditionsSnapshot,
  findConditionsRangeWarnings,
  InvalidConditionsPayloadError,
} from "./conditionsDecoder";

function snapshot(wbgt: unknown, humidity: unknown): string {
  return JSON.stringify({
    siteId: "550e8400-e29b-41d4-a716-446655440000",
    conditions: {
      wbgt,
      temperature: 32,
      humidity,
      windSpeed: 2,
      rainfall: 0,
      observedAt: "2026-08-11T08:00:00Z",
      source: "NEA",
      freshness: "LIVE",
    },
    lightning: null,
    activeShift: null,
    asOf: "2026-08-11T08:00:10Z",
  });
}

describe("conditionsDecoder sanity warnings", () => {
  it.each([
    [20, 30],
    [36, 100],
  ])("accepts boundary values without warnings", (wbgt, humidity) => {
    expect(findConditionsRangeWarnings({ wbgt, humidity })).toEqual([]);
  });

  it.each([
    {
      name: "warns just below the humidity minimum",
      wbgt: 30,
      humidity: 29.9,
      expected: [{ metric: "humidity", value: 29.9, minimum: 30, maximum: 100 }],
    },
    {
      name: "accepts humidity just above the minimum",
      wbgt: 30,
      humidity: 30.1,
      expected: [],
    },
    {
      name: "warns just above the humidity maximum",
      wbgt: 30,
      humidity: 100.1,
      expected: [{ metric: "humidity", value: 100.1, minimum: 30, maximum: 100 }],
    },
    {
      name: "warns just below the WBGT minimum",
      wbgt: 19.9,
      humidity: 70,
      expected: [{ metric: "wbgt", value: 19.9, minimum: 20, maximum: 36 }],
    },
    {
      name: "accepts WBGT just above the minimum",
      wbgt: 20.1,
      humidity: 70,
      expected: [],
    },
    {
      name: "accepts WBGT just below the maximum",
      wbgt: 35.9,
      humidity: 70,
      expected: [],
    },
    {
      name: "warns just above the WBGT maximum",
      wbgt: 36.1,
      humidity: 70,
      expected: [{ metric: "wbgt", value: 36.1, minimum: 20, maximum: 36 }],
    },
  ])("$name", ({ wbgt, humidity, expected }) => {
    expect(findConditionsRangeWarnings({ wbgt, humidity })).toEqual(expected);
  });

  it("returns an out-of-range finite reading with a warning", () => {
    const decoded = decodeConditionsSnapshot(snapshot(37.2, 70));

    expect(decoded.snapshot.conditions?.wbgt).toBe(37.2);
    expect(decoded.warnings).toEqual([
      { metric: "wbgt", value: 37.2, minimum: 20, maximum: 36 },
    ]);
  });

  it("still rejects structurally invalid measurements", () => {
    expect(() => decodeConditionsSnapshot(snapshot("37.2", 70)))
      .toThrow(InvalidConditionsPayloadError);
  });
});
