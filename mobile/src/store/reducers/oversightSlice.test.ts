/**
 * `loadSitePlans` returns a site's plans newest-first (SCRUM-TBD-110).
 *
 * ── WHY THE FIXTURE USES TWO SHIFTS ─────────────────────────────────────────────────────
 * This is the whole reason the ordering bug survived to production. `items` is built by
 * flat-mapping one `fetchRecommendations` call per shift, so with ONE shift the array is
 * already in the server's order and looks correct whether or not a sort exists. It is only
 * when a second shift's plans are appended after the first shift's that the interleaving goes
 * wrong — which is how a plan drafted at 15:17 came to render above one drafted at 15:09.
 *
 * A single-shift test would have passed against the broken code.
 */
const mockFetchShifts = jest.fn();
const mockFetchRecommendations = jest.fn();
jest.mock("@/api/endpoints/shifts", () => ({
  fetchShifts: (...a: unknown[]) => mockFetchShifts(...a),
}));
jest.mock("@/api/endpoints/recommendations", () => ({
  fetchRecommendations: (...a: unknown[]) => mockFetchRecommendations(...a),
}));
jest.mock("@/api/endpoints/sites", () => ({ fetchAccessibleSites: jest.fn() }));
jest.mock("@/api/endpoints/oversight", () => ({ fetchPlanSummary: jest.fn() }));

import { configureStore } from "@reduxjs/toolkit";

import oversightReducer, { loadSitePlans } from "./oversightSlice";
import type { Recommendation } from "@/types/domain";

function plan(id: string, shiftId: string, createdAt: string): Recommendation {
  return {
    id,
    shiftId,
    policyVersion: null,
    status: "PENDING_APPROVAL",
    rationale: null,
    createdAt,
    mitigations: [],
    approval: null,
    modelVersion: "anthropic.claude-3-5-sonnet",
  };
}

function buildStore() {
  return configureStore({ reducer: { oversight: oversightReducer } });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchShifts.mockResolvedValue([
    { id: "shift-a", startsAt: "2026-08-18T06:00:00Z", endsAt: "2026-08-18T14:00:00Z" },
    { id: "shift-b", startsAt: "2026-08-18T14:00:00Z", endsAt: "2026-08-18T22:00:00Z" },
  ]);
});

it("orders plans newest-first across shifts, not by which shift resolved", async () => {
  // Shift A's plans straddle shift B's in time. Un-sorted, the array would come back as
  // A's two then B's two — 15:26, 14:39, 15:17, 14:38 — which is what shipped.
  mockFetchRecommendations
    .mockResolvedValueOnce([
      plan("a2", "shift-a", "2026-08-18T15:26:00Z"),
      plan("a1", "shift-a", "2026-08-18T14:39:00Z"),
    ])
    .mockResolvedValueOnce([
      plan("b2", "shift-b", "2026-08-18T15:17:00Z"),
      plan("b1", "shift-b", "2026-08-18T14:38:00Z"),
    ]);

  const store = buildStore();
  await store.dispatch(loadSitePlans({ siteId: "site-1" }));

  expect(store.getState().oversight.plansBySite["site-1"].items.map((p) => p.id)).toEqual([
    "a2",
    "b2",
    "a1",
    "b1",
  ]);
});

it("breaks ties deterministically so rows do not swap between polls", async () => {
  // Two plans can share a createdAt to the second. An unstable order would move a row under
  // a manager's thumb as they reach for it.
  mockFetchRecommendations
    .mockResolvedValueOnce([plan("zzz", "shift-a", "2026-08-18T15:00:00Z")])
    .mockResolvedValueOnce([plan("aaa", "shift-b", "2026-08-18T15:00:00Z")]);

  const store = buildStore();
  await store.dispatch(loadSitePlans({ siteId: "site-1" }));

  expect(store.getState().oversight.plansBySite["site-1"].items.map((p) => p.id)).toEqual([
    "aaa",
    "zzz",
  ]);
});

it("keeps the shift windows instead of discarding them", async () => {
  // They arrive with the shifts already fetched, and without them a site running two crews
  // renders two plan rows with nothing saying which is which.
  mockFetchRecommendations.mockResolvedValue([]);

  const store = buildStore();
  await store.dispatch(loadSitePlans({ siteId: "site-1" }));

  const { shifts } = store.getState().oversight.plansBySite["site-1"];
  expect(shifts.map((s) => s.id)).toEqual(["shift-a", "shift-b"]);
  expect(shifts[0].startsAt).toBe("2026-08-18T06:00:00Z");
});

it("keeps the plans it already had when a refresh fails", async () => {
  // Per-shift, not a blanket mockResolvedValue: both shifts would otherwise return the same
  // plan and the site would appear to hold it twice.
  mockFetchRecommendations
    .mockResolvedValueOnce([plan("a1", "shift-a", "2026-08-18T15:00:00Z")])
    .mockResolvedValueOnce([]);
  const store = buildStore();
  await store.dispatch(loadSitePlans({ siteId: "site-1" }));

  mockFetchShifts.mockRejectedValueOnce(new Error("network"));
  await store.dispatch(loadSitePlans({ siteId: "site-1" }));

  const entry = store.getState().oversight.plansBySite["site-1"];
  expect(entry.status).toBe("ready");
  expect(entry.items.map((p) => p.id)).toEqual(["a1"]);
});

it("drops only the shift that failed, not the whole site", async () => {
  // Promise.allSettled across shifts: one shift 403-ing because it moved site must not blank
  // a manager's view of the rest.
  mockFetchRecommendations
    .mockRejectedValueOnce(new Error("forbidden"))
    .mockResolvedValueOnce([plan("b1", "shift-b", "2026-08-18T15:00:00Z")]);

  const store = buildStore();
  await store.dispatch(loadSitePlans({ siteId: "site-1" }));

  const entry = store.getState().oversight.plansBySite["site-1"];
  expect(entry.status).toBe("ready");
  expect(entry.items.map((p) => p.id)).toEqual(["b1"]);
});
