/** @author Tang Chee Seng (with assistance from Claude) */

import type { FetchEventSourceInit } from "@microsoft/fetch-event-source";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionStatusStreamHandlers } from "./actionStatusStream";
import { subscribeToActionStatus } from "./actionStatusStream";

const streamMock = vi.hoisted(() => ({
  options: null as FetchEventSourceInit | null,
}));

vi.mock("@microsoft/fetch-event-source", () => ({
  fetchEventSource: vi.fn((_input: RequestInfo, options: FetchEventSourceInit) => {
    streamMock.options = options;
    return new Promise<void>(() => undefined);
  }),
}));

type JsonObject = Record<string, unknown>;

function dispatch(mutate: (value: JsonObject) => void = () => {}): string {
  const value: JsonObject = {
    id: "550e8400-e29b-41d4-a716-446655440001",
    recommendationId: "550e8400-e29b-41d4-a716-446655440002",
    approvalId: null,
    workerId: "550e8400-e29b-41d4-a716-446655440003",
    actionCode: "HYDRATE",
    instruction: "Take a 10 minute water break",
    startTime: null,
    endTime: null,
    status: "PENDING",
    dispatchedAt: "2026-08-20T08:00:00Z",
    lateAt: null,
    completedBy: null,
  };
  mutate(value);
  return JSON.stringify(value);
}

function alertCount(mutate: (value: JsonObject) => void = () => {}): string {
  const value: JsonObject = {
    siteId: "550e8400-e29b-41d4-a716-446655440000",
    pending: 1,
    late: 0,
    acknowledged: 0,
    completed: 0,
    asOf: "2026-08-20T08:00:10Z",
  };
  mutate(value);
  return JSON.stringify(value);
}

const send = (event: string, data: string) =>
  streamMock.options?.onmessage?.({ id: "x", event, data });

describe("subscribeToActionStatus tick-boundary buffering", () => {
  let handlers: ActionStatusStreamHandlers;

  beforeEach(() => {
    streamMock.options = null;
    handlers = { onTick: vi.fn(), onStatus: vi.fn() };
    subscribeToActionStatus("site-1", handlers);
  });

  it("buffers action-status events and only commits on alert-count", () => {
    send("action-status", dispatch());
    // Mid-tick: nothing committed yet — a half-received tick must never reach the consumer.
    expect(handlers.onTick).not.toHaveBeenCalled();

    send("alert-count", alertCount());

    expect(handlers.onStatus).toHaveBeenLastCalledWith("live");
    expect(handlers.onTick).toHaveBeenCalledTimes(1);
    expect(handlers.onTick).toHaveBeenCalledWith(
      [expect.objectContaining({ status: "PENDING", approvalId: null })],
      expect.objectContaining({ pending: 1, siteId: "550e8400-e29b-41d4-a716-446655440000" }),
    );
  });

  it("commits every dispatch in a multi-event tick as one set", () => {
    send("action-status", dispatch((d) => { d.id = "550e8400-e29b-41d4-a716-446655440011"; d.status = "LATE"; d.lateAt = "2026-08-20T08:05:00Z"; }));
    send("action-status", dispatch((d) => { d.id = "550e8400-e29b-41d4-a716-446655440012"; d.status = "COMPLETED"; d.completedBy = "WORKER"; }));
    send("alert-count", alertCount((c) => { c.pending = 0; c.late = 1; c.completed = 1; }));

    expect(handlers.onTick).toHaveBeenCalledTimes(1);
    const firstCall = vi.mocked(handlers.onTick).mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall![0]).toHaveLength(2);
  });

  it("treats an empty all-zero tick (no active shift) as live, not an error", () => {
    send("alert-count", alertCount((c) => { c.pending = 0; }));

    expect(handlers.onStatus).toHaveBeenLastCalledWith("live");
    expect(handlers.onTick).toHaveBeenCalledWith([], expect.objectContaining({ pending: 0 }));
  });

  it("accepts CANCELLED and a fully-populated dispatch", () => {
    send("action-status", dispatch((d) => {
      d.status = "CANCELLED";
      d.approvalId = "550e8400-e29b-41d4-a716-446655440099";
      d.startTime = "2026-08-20T08:00:00Z";
      d.endTime = "2026-08-20T08:30:00Z";
    }));
    send("alert-count", alertCount((c) => { c.pending = 0; }));

    expect(handlers.onTick).toHaveBeenCalledWith(
      [expect.objectContaining({ status: "CANCELLED", approvalId: "550e8400-e29b-41d4-a716-446655440099" })],
      expect.anything(),
    );
  });

  it.each([
    ["malformed JSON", "{"],
    ["a bad status enum", dispatch((d) => { d.status = "UNKNOWN"; })],
  ])("drops the whole tick and degrades when an action-status is %s", (_name, bad) => {
    send("action-status", dispatch()); // one good dispatch first
    send("action-status", bad); // poisons the tick
    expect(handlers.onStatus).toHaveBeenLastCalledWith("degraded");

    send("alert-count", alertCount()); // tick boundary — the poisoned tick is dropped
    expect(handlers.onTick).not.toHaveBeenCalled();

    // ...and the buffer is clean for the next tick — the dropped tick's good dispatch must
    // not leak forward.
    send("action-status", dispatch((d) => { d.status = "COMPLETED"; }));
    send("alert-count", alertCount((c) => { c.pending = 0; c.completed = 1; }));
    expect(handlers.onTick).toHaveBeenCalledTimes(1);
    expect(handlers.onTick).toHaveBeenLastCalledWith(
      [expect.objectContaining({ status: "COMPLETED" })],
      expect.objectContaining({ completed: 1 }),
    );
  });

  it("degrades and commits nothing when the alert-count itself is malformed", () => {
    send("action-status", dispatch());
    send("alert-count", alertCount((c) => { c.pending = "1"; })); // wrong type

    expect(handlers.onStatus).toHaveBeenLastCalledWith("degraded");
    expect(handlers.onTick).not.toHaveBeenCalled();
  });
});
