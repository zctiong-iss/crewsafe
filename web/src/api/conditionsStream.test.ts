/** @author Tang Chee Seng (with assistance from Claude and ChatGPT) */

import type { FetchEventSourceInit } from "@microsoft/fetch-event-source";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConditionsStreamHandlers } from "./conditionsStream";
import { subscribeToConditions } from "./conditionsStream";

const streamMock = vi.hoisted(() => ({
  options: null as FetchEventSourceInit | null,
}));

vi.mock("@microsoft/fetch-event-source", () => ({
  fetchEventSource: vi.fn(
    (_input: RequestInfo, options: FetchEventSourceInit) => {
      streamMock.options = options;
      return new Promise<void>(() => undefined);
    },
  ),
}));

type JsonObject = Record<string, unknown>;

function child(value: JsonObject, key: string): JsonObject {
  return value[key] as JsonObject;
}

function payload(mutate: (value: JsonObject) => void = () => {}): string {
  const value: JsonObject = {
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
    lightning: null,
    activeShift: null,
    asOf: "2026-08-11T08:00:10Z",
  };

  mutate(value);
  return JSON.stringify(value);
}

describe("subscribeToConditions runtime boundary", () => {
  let handlers: ConditionsStreamHandlers;

  beforeEach(() => {
    streamMock.options = null;
    handlers = {
      onSnapshot: vi.fn(),
      onStatus: vi.fn(),
    };
    subscribeToConditions("site-1", handlers);
  });

  it("delivers a valid snapshot and leaves the stream live", () => {
    streamMock.options?.onmessage?.({
      id: "1",
      event: "conditions",
      data: payload(),
    });

    expect(handlers.onStatus).toHaveBeenLastCalledWith("live");
    expect(handlers.onSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: "550e8400-e29b-41d4-a716-446655440000",
      }),
      [],
    );
  });

  it.each([
    ["malformed JSON", "{"],
    ["a structurally invalid payload", payload((value) => {
      child(value, "conditions").wbgt = "31";
    })],
  ])("degrades and suppresses %s", (_name, data) => {
    streamMock.options?.onmessage?.({ id: "2", event: "conditions", data });

    expect(handlers.onStatus).toHaveBeenLastCalledWith("degraded");
    expect(handlers.onSnapshot).not.toHaveBeenCalled();
  });

  it("accepts a nullable conditions child and leaves the stream live", () => {
    streamMock.options?.onmessage?.({
      id: "3",
      event: "conditions",
      data: payload((value) => { value.conditions = null; }),
    });

    expect(handlers.onStatus).toHaveBeenLastCalledWith("live");
    expect(handlers.onSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ conditions: null }),
      [],
    );
  });

  it.each([
    ["WBGT", (value: JsonObject) => { child(value, "conditions").wbgt = 36.1; }, "wbgt", 36.1, 20, 36],
    ["humidity", (value: JsonObject) => { child(value, "conditions").humidity = 100.1; }, "humidity", 100.1, 30, 100],
  ])("delivers an implausible finite %s reading with a warning and stays live", (
    _name,
    mutate,
    metric,
    value,
    minimum,
    maximum,
  ) => {
    streamMock.options?.onmessage?.({
      id: "5",
      event: "conditions",
      data: payload(mutate),
    });

    expect(handlers.onStatus).toHaveBeenLastCalledWith("live");
    expect(handlers.onSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: expect.objectContaining({ [metric]: value }),
      }),
      [{ metric, value, minimum, maximum }],
    );
  });
});
