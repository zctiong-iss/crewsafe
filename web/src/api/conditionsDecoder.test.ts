/** @author Tang Chee Seng, Jemilin Beulah (with assistance from Claude and ChatGPT) */

import { describe, expect, it } from "vitest";
import {
  decodeConditionsSnapshot,
  findConditionsRangeWarnings,
  InvalidConditionsPayloadError,
} from "./conditionsDecoder";

type JsonObject = Record<string, unknown>;

function validPayload(): JsonObject {
  return {
    siteId: "550e8400-e29b-41d4-a716-446655440000",
    conditions: {
      wbgt: 31,
      temperature: 32,
      humidity: 70,
      windSpeed: 2,
      rainfall: 0,
      observedAt: "2026-08-11T08:00:00Z",
      source: "NEA",
      freshness: "LIVE",
    },
    lightning: {
      state: "CLEAR",
      nearestStrikeKm: 12,
      observedAt: "2026-08-11T08:00:00Z",
      validUntil: "2026-08-11T08:05:00Z",
      freshness: "LIVE",
    },
    activeShift: {
      shiftId: "550e8400-e29b-41d4-a716-446655440001",
      startsAt: "2026-08-11T07:00:00Z",
      endsAt: "2026-08-11T15:00:00Z",
    },
    asOf: "2026-08-11T08:00:10Z",
  };
}

function child(value: JsonObject, key: string): JsonObject {
  return value[key] as JsonObject;
}

function encode(change?: (value: JsonObject) => void): string {
  const value = validPayload();
  change?.(value);
  return JSON.stringify(value);
}

describe("decodeConditionsSnapshot", () => {
  it("decodes a complete valid snapshot without warnings", () => {
    const decoded = decodeConditionsSnapshot(encode());

    expect(decoded.snapshot.siteId).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(decoded.snapshot.conditions?.wbgt).toBe(31);
    expect(decoded.warnings).toEqual([]);
  });

  it("accepts the three nullable child payloads", () => {
    const decoded = decodeConditionsSnapshot(encode((value) => {
      value.conditions = null;
      value.lightning = null;
      value.activeShift = null;
    }));

    expect(decoded.snapshot.conditions).toBeNull();
    expect(decoded.snapshot.lightning).toBeNull();
    expect(decoded.snapshot.activeShift).toBeNull();
    expect(decoded.warnings).toEqual([]);
  });

  it("decodes server-classified current and forecast bands", () => {
    const decoded = decodeConditionsSnapshot(encode((value) => {
      const conditions = child(value, "conditions");
      conditions.currentBand = "32_TO_BELOW_33";
      conditions.forecastBand = "33_AND_ABOVE";
      conditions.forecastWbgt30m = 33.2;
    }));

    expect(decoded.snapshot.conditions?.currentBand).toBe("32_TO_BELOW_33");
    expect(decoded.snapshot.conditions?.forecastBand).toBe("33_AND_ABOVE");
    expect(decoded.snapshot.conditions?.forecastWbgt30m).toBe(33.2);
  });

  it("tolerates a null forecast band and value", () => {
    const decoded = decodeConditionsSnapshot(encode((value) => {
      const conditions = child(value, "conditions");
      conditions.currentBand = "BELOW_31";
      conditions.forecastBand = null;
      conditions.forecastWbgt30m = null;
    }));

    expect(decoded.snapshot.conditions?.forecastBand).toBeNull();
    expect(decoded.snapshot.conditions?.forecastWbgt30m).toBeNull();
  });

  it("rejects an unknown band string at the boundary", () => {
    expect(() =>
      decodeConditionsSnapshot(encode((value) => {
        child(value, "conditions").currentBand = "SCORCHING";
      })),
    ).toThrow(InvalidConditionsPayloadError);
  });

  it("accepts a null nearestStrikeKm on a CLEAR lightning state", () => {
    const decoded = decodeConditionsSnapshot(encode((value) => {
      child(value, "lightning").nearestStrikeKm = null;
    }));

    expect(decoded.snapshot.lightning?.nearestStrikeKm).toBeNull();
  });

  it.each([
    ["malformed JSON", "{"],
    ["a non-object root", "[]"],
  ])("rejects %s", (_name, data) => {
    expect(() => decodeConditionsSnapshot(data)).toThrow(
      InvalidConditionsPayloadError,
    );
  });

  const invalidCases: Array<[
    string,
    (value: JsonObject) => void,
  ]> = [
    ["an invalid site UUID", (value) => { value.siteId = "site-1"; }],
    ["an unparseable asOf", (value) => { value.asOf = "not-a-date"; }],
    ["a non-object conditions value", (value) => { value.conditions = []; }],
    ["a string WBGT", (value) => { child(value, "conditions").wbgt = "31"; }],
    ["a bad source enum", (value) => { child(value, "conditions").source = "OTHER"; }],
    ["a bad freshness enum", (value) => { child(value, "conditions").freshness = "FRESH"; }],
    ["an unparseable observedAt", (value) => { child(value, "conditions").observedAt = "never"; }],
    ["negative wind speed", (value) => { child(value, "conditions").windSpeed = -0.1; }],
    ["negative rainfall", (value) => { child(value, "conditions").rainfall = -0.1; }],
    ["a bad lightning enum", (value) => { child(value, "lightning").state = "UNKNOWN"; }],
    ["a negative strike distance", (value) => { child(value, "lightning").nearestStrikeKm = -0.1; }],
    ["an invalid shift UUID", (value) => { child(value, "activeShift").shiftId = "shift-1"; }],
    ["an unparseable shift end", (value) => { child(value, "activeShift").endsAt = "later"; }],
  ];

  it.each(invalidCases)("rejects %s", (_name, change) => {
    expect(() => decodeConditionsSnapshot(encode(change))).toThrow(
      InvalidConditionsPayloadError,
    );
  });

  it("rejects a non-finite numeric result", () => {
    const data = encode().replace('"wbgt":31', '"wbgt":1e400');
    expect(() => decodeConditionsSnapshot(data)).toThrow(
      InvalidConditionsPayloadError,
    );
  });
});

describe("conditions sanity warnings", () => {
  it.each([
    [20, 30],
    [36, 100],
  ])("accepts exact boundaries: WBGT %s, humidity %s", (wbgt, humidity) => {
    expect(findConditionsRangeWarnings({ wbgt, humidity })).toEqual([]);
  });

  it.each([
    [19.9, 70, "wbgt", 19.9],
    [36.1, 70, "wbgt", 36.1],
    [30, 29.9, "humidity", 29.9],
    [30, 100.1, "humidity", 100.1],
  ])("warns for WBGT %s and humidity %s", (
    wbgt,
    humidity,
    metric,
    value,
  ) => {
    expect(findConditionsRangeWarnings({ wbgt, humidity })).toEqual([
      expect.objectContaining({ metric, value }),
    ]);
  });

  it("returns a finite implausible reading with its warning", () => {
    const decoded = decodeConditionsSnapshot(encode((value) => {
      child(value, "conditions").wbgt = 37.2;
    }));

    expect(decoded.snapshot.conditions?.wbgt).toBe(37.2);
    expect(decoded.warnings).toEqual([
      { metric: "wbgt", value: 37.2, minimum: 20, maximum: 36 },
    ]);
  });
});