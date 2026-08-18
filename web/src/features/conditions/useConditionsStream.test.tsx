/** @author Tang Chee Seng (with assistance from Claude and ChatGPT) */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  ConditionsSnapshot,
  ConditionsStreamHandlers,
} from "@/api/conditionsStream";
import { useConditionsStream } from "./useConditionsStream";

function snapshot(wbgt: number, observedAt: string): ConditionsSnapshot {
  return {
    siteId: "550e8400-e29b-41d4-a716-446655440000",
    asOf: observedAt,
    activeShift: null,
    lightning: null,
    conditions: {
      wbgt,
      currentBand: null,
      forecastBand: null,
      forecastWbgt30m: null,
      temperature: 32,
      humidity: 70,
      windSpeed: 2,
      rainfall: 0,
      observedAt,
      source: "NEA",
      freshness: "LIVE",
    },
  };
}

describe("useConditionsStream range-warning handling", () => {
  it("keeps a warned WBGT snapshot live but quarantines it from the trend", () => {
    let handlers: ConditionsStreamHandlers | null = null;
    const subscribe = (_siteId: string, next: ConditionsStreamHandlers) => {
      handlers = next;
      return () => undefined;
    };

    const { result } = renderHook(() =>
      useConditionsStream("site-1", subscribe),
    );

    act(() => {
      handlers?.onStatus("live");
      handlers?.onSnapshot(snapshot(36.1, "2026-08-11T08:00:00Z"), [
        { metric: "wbgt", value: 36.1, minimum: 20, maximum: 36 },
      ]);
    });

    expect(result.current.connectionState).toBe("live");
    expect(result.current.snapshot?.conditions?.wbgt).toBe(36.1);
    expect(result.current.rangeWarnings).toHaveLength(1);
    expect(result.current.trend).toEqual([]);

    act(() => {
      handlers?.onSnapshot(snapshot(35, "2026-08-11T08:01:00Z"), []);
    });

    expect(result.current.rangeWarnings).toEqual([]);
    expect(result.current.trend).toEqual([
      { observedAt: "2026-08-11T08:01:00Z", wbgt: 35 },
    ]);
  });
});