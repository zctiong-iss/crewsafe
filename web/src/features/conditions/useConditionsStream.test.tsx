/** @author Tang Chee Seng (with assistance from Claude and ChatGPT) */

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConditionsHistory } from "@/api/conditionsHistory";
import type {
  ConditionsSnapshot,
  ConditionsStreamHandlers,
} from "@/api/conditionsStream";
import { useConditionsStream } from "./useConditionsStream";

function snapshot(wbgt: number, observedAt: string, asOf = observedAt): ConditionsSnapshot {
  return {
    siteId: "550e8400-e29b-41d4-a716-446655440000",
    asOf,
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

function history(
  points: ConditionsHistory["points"],
  asOf = "2026-08-20T09:00:00Z",
): ConditionsHistory {
  return {
    from: "2026-08-20T05:00:00Z",
    asOf,
    points,
  };
}

const pendingHistory = () => new Promise<ConditionsHistory>(() => undefined);

describe("useConditionsStream", () => {
  it("keeps a warned WBGT snapshot live but quarantines it from the trend", () => {
    let handlers: ConditionsStreamHandlers | null = null;
    const subscribe = (_siteId: string, next: ConditionsStreamHandlers) => {
      handlers = next;
      return () => undefined;
    };

    const { result } = renderHook(() =>
      useConditionsStream("site-1", subscribe, pendingHistory),
    );

    act(() => {
      handlers?.onStatus("live");
      handlers?.onSnapshot(snapshot(36.1, "2026-08-20T08:00:00Z"), [
        { metric: "wbgt", value: 36.1, minimum: 20, maximum: 36 },
      ]);
    });

    expect(result.current.connectionState).toBe("live");
    expect(result.current.snapshot?.conditions?.wbgt).toBe(36.1);
    expect(result.current.rangeWarnings).toHaveLength(1);
    expect(result.current.trend).toEqual([]);

    act(() => {
      handlers?.onSnapshot(snapshot(35, "2026-08-20T08:01:00Z"), []);
    });

    expect(result.current.rangeWarnings).toEqual([]);
    expect(result.current.trend).toEqual([
      { observedAt: "2026-08-20T08:01:00Z", wbgt: 35 },
    ]);
  });

  it("advances the rolling cutoff even when the newest WBGT is quarantined", async () => {
    let handlers!: ConditionsStreamHandlers;
    const subscribe = (_siteId: string, next: ConditionsStreamHandlers) => {
      handlers = next;
      return () => undefined;
    };
    const loadHistory = async () => history([
      { observedAt: "2026-08-20T05:00:00Z", wbgt: 27.3 },
    ]);

    const { result } = renderHook(() =>
      useConditionsStream("site-1", subscribe, loadHistory),
    );
    await waitFor(() => expect(result.current.historyState).toBe("ready"));

    act(() => {
      handlers.onStatus("live");
      handlers.onSnapshot(
        snapshot(36.1, "2026-08-20T09:15:00Z"),
        [{ metric: "wbgt", value: 36.1, minimum: 20, maximum: 36 }],
      );
    });

    expect(result.current.trend).toEqual([]);
  });

  it("merges history that resolves after SSE without overwriting the live value", async () => {
    let handlers!: ConditionsStreamHandlers;
    let resolveHistory!: (value: ConditionsHistory) => void;
    const subscribe = (_siteId: string, next: ConditionsStreamHandlers) => {
      handlers = next;
      return () => undefined;
    };
    const loadHistory = () => new Promise<ConditionsHistory>((resolve) => {
      resolveHistory = resolve;
    });

    const { result } = renderHook(() =>
      useConditionsStream("site-1", subscribe, loadHistory),
    );

    act(() => {
      handlers.onStatus("live");
      handlers.onSnapshot(
        snapshot(31.4, "2026-08-20T08:45:00Z", "2026-08-20T09:00:01Z"),
        [],
      );
    });

    await act(async () => {
      resolveHistory(history([
        { observedAt: "2026-08-20T06:00:00Z", wbgt: 27.3 },
        { observedAt: "2026-08-20T08:45:00Z", wbgt: 29.1 },
      ]));
    });

    expect(result.current.historyState).toBe("ready");
    expect(result.current.trend).toEqual([
      { observedAt: "2026-08-20T06:00:00Z", wbgt: 27.3 },
      { observedAt: "2026-08-20T08:45:00Z", wbgt: 31.4 },
    ]);
  });

  it("keeps live updates when history loading fails", async () => {
    let handlers!: ConditionsStreamHandlers;
    const subscribe = (_siteId: string, next: ConditionsStreamHandlers) => {
      handlers = next;
      return () => undefined;
    };
    const loadHistory = async () => {
      throw new Error("history unavailable");
    };

    const { result } = renderHook(() =>
      useConditionsStream("site-1", subscribe, loadHistory),
    );

    await waitFor(() => expect(result.current.historyState).toBe("unavailable"));
    act(() => {
      handlers.onStatus("live");
      handlers.onSnapshot(snapshot(29.1, "2026-08-20T08:45:00Z"), []);
    });

    expect(result.current.trend).toEqual([
      { observedAt: "2026-08-20T08:45:00Z", wbgt: 29.1 },
    ]);
  });

  it("reloads history when the tab becomes visible", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    const loadHistory = vi.fn().mockResolvedValue(history([]));
    const subscribe = () => () => undefined;

    renderHook(() => useConditionsStream("site-1", subscribe, loadHistory));
    await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(1));

    act(() => document.dispatchEvent(new Event("visibilitychange")));

    await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(2));
  });

  it("aborts and ignores stale history when the selected site changes", async () => {
    const requests: Array<{
      siteId: string;
      signal: AbortSignal | undefined;
      resolve: (value: ConditionsHistory) => void;
    }> = [];
    const handlersBySite = new Map<string, ConditionsStreamHandlers>();
    const subscribe = (siteId: string, handlers: ConditionsStreamHandlers) => {
      handlersBySite.set(siteId, handlers);
      return () => undefined;
    };
    const loadHistory = (siteId: string, signal?: AbortSignal) =>
      new Promise<ConditionsHistory>((resolve) => {
        requests.push({ siteId, signal, resolve });
      });

    const { result, rerender } = renderHook(
      ({ siteId }) => useConditionsStream(siteId, subscribe, loadHistory),
      { initialProps: { siteId: "site-1" } },
    );
    act(() => {
      handlersBySite.get("site-1")?.onStatus("live");
      handlersBySite.get("site-1")?.onSnapshot(
        snapshot(29.1, "2026-08-20T08:45:00Z"),
        [],
      );
    });

    rerender({ siteId: "site-2" });

    expect(requests[0]?.signal?.aborted).toBe(true);
    expect(result.current.snapshot).toBeNull();
    expect(result.current.trend).toEqual([]);

    await act(async () => {
      requests[0]?.resolve(history([
        { observedAt: "2026-08-20T06:00:00Z", wbgt: 27.3 },
      ]));
    });

    expect(result.current.trend).toEqual([]);
    expect(requests[1]?.siteId).toBe("site-2");
  });
});
