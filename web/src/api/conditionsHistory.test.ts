import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import {
  decodeConditionsHistory,
  fetchConditionsHistory,
  InvalidConditionsHistoryPayloadError,
} from "./conditionsHistory";

describe("decodeConditionsHistory", () => {
  it("accepts the server envelope and quarantines out-of-range WBGT points", () => {
    const history = decodeConditionsHistory({
      from: "2026-08-20T05:00:00Z",
      asOf: "2026-08-20T09:00:00Z",
      points: [
        { observedAt: "2026-08-20T05:15:00Z", wbgt: 19.9 },
        { observedAt: "2026-08-20T05:30:00Z", wbgt: 20 },
        { observedAt: "2026-08-20T08:30:00Z", wbgt: 36 },
        { observedAt: "2026-08-20T08:45:00Z", wbgt: 36.1 },
      ],
    });

    expect(history.points).toEqual([
      { observedAt: "2026-08-20T05:30:00Z", wbgt: 20 },
      { observedAt: "2026-08-20T08:30:00Z", wbgt: 36 },
    ]);
  });

  it("rejects a structurally invalid history point", () => {
    expect(() => decodeConditionsHistory({
      from: "2026-08-20T05:00:00Z",
      asOf: "2026-08-20T09:00:00Z",
      points: [{ observedAt: "not-a-time", wbgt: "29.1" }],
    })).toThrow(InvalidConditionsHistoryPayloadError);
  });
});

describe("fetchConditionsHistory", () => {
  it("loads and validates the site-scoped history endpoint", async () => {
    server.use(
      http.get("*/api/v1/sites/:siteId/conditions/history", ({ params }) =>
        HttpResponse.json({
          from: "2026-08-20T05:00:00Z",
          asOf: "2026-08-20T09:00:00Z",
          points: [{ observedAt: "2026-08-20T08:45:00Z", wbgt: 29.1 }],
          requestedSite: params.siteId,
        })),
    );

    await expect(fetchConditionsHistory("site-1")).resolves.toEqual({
      from: "2026-08-20T05:00:00Z",
      asOf: "2026-08-20T09:00:00Z",
      points: [{ observedAt: "2026-08-20T08:45:00Z", wbgt: 29.1 }],
    });
  });
});
