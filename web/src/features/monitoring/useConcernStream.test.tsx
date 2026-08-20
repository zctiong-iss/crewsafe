import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Concern, ConcernStreamHandlers } from "@/api/concernStream";
import { useConcernStream } from "./useConcernStream";

const oneConcern: Concern = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  shiftId: "550e8400-e29b-41d4-a716-446655440002",
  workerId: "550e8400-e29b-41d4-a716-446655440003",
  symptoms: ["DIZZINESS"],
  note: null,
  status: "OPEN" as const,
  raisedAt: "2026-08-20T08:00:00Z",
  acknowledgedAt: null,
};

describe("useConcernStream", () => {
  it("replaces snapshots, retains them while degraded, and unsubscribes on site change", () => {
    const cleanups = [vi.fn(), vi.fn()];
    let subscribeCount = 0;
    const subscribe = (siteId: string, handlers: ConcernStreamHandlers) => {
      expect(siteId).toMatch(/^site-/);
      handlersForTest = handlers;
      if (siteId === "site-1") {
        handlers.onStatus("live");
        handlers.onSnapshot([oneConcern]);
      }
      const cleanup = cleanups[subscribeCount];
      subscribeCount += 1;
      return cleanup!;
    };

    const { result, rerender } = renderHook(
      ({ siteId }) => useConcernStream(siteId, subscribe),
      { initialProps: { siteId: "site-1" } },
    );
    expect(result.current.concerns).toHaveLength(1);
    expect(result.current.connectionState).toBe("live");
    expect(result.current.hasSnapshot).toBe(true);

    act(() => {
      // The stream status callback is what marks the retained snapshot degraded.
      // The hook's injected transport is intentionally small; the live transport test covers parsing.
      handlersForTest?.onStatus("degraded");
    });
    expect(result.current.concerns).toHaveLength(1);
    rerender({ siteId: "site-2" });
    expect(cleanups[0]).toHaveBeenCalledOnce();
    expect(result.current.concerns).toHaveLength(0);
    expect(result.current.connectionState).toBe("connecting");
  });
});

let handlersForTest: ConcernStreamHandlers | undefined;
