/**
 * One notification for a batch, and the payload that decides where a tap lands.
 *
 * The auto-trigger drafts per shift, so a supervisor running four shifts can have four plans
 * appear in a single poll. Four notifications in one second is not four times as useful as one
 * — it is a phone that gets silenced, and the next real one gets silenced with it.
 *
 * @author Justin Chua
 */
const mockPresentNow = jest.fn((_title: string, _body: string, _data?: Record<string, unknown>) =>
  Promise.resolve(true),
);

jest.mock("./notificationClient", () => ({
  presentNow: (title: string, body: string, data?: Record<string, unknown>) =>
    mockPresentNow(title, body, data),
}));
jest.mock("@/localization/i18n", () => ({
  __esModule: true,
  default: {
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  },
}));

import { announceDraftedPlans, isAwaitingDecision } from "./planNotifications";
import type { Recommendation } from "@/types/domain";

function plan(id: string, overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id,
    shiftId: `shift-for-${id}`,
    policyVersion: null,
    status: "PENDING_APPROVAL",
    rationale: null,
    createdAt: "2026-08-18T01:00:00Z",
    mitigations: [],
    approval: null,
    modelVersion: "anthropic.claude-3-5-sonnet",
    ...overrides,
  } as Recommendation;
}

beforeEach(() => jest.clearAllMocks());

describe("which plans are worth interrupting someone for", () => {
  it("counts one that is awaiting a decision", () => {
    expect(isAwaitingDecision(plan("rec-1"))).toBe(true);
  });

  it.each(["APPROVED", "REJECTED", "SUPERSEDED", "DRAFT"] as const)(
    "does not count a %s plan",
    (status) => {
      /*
       * The auto-trigger supersedes its own drafts between polls, so this is a real case
       * rather than a theoretical one. A plan that is not asking for a decision has no action
       * attached, and spending the app's one signal on it makes the next one easier to ignore.
       */
      expect(isAwaitingDecision(plan("rec-1", { status }))).toBe(false);
    },
  );
});

describe("announcing", () => {
  it("says nothing when there is nothing new", async () => {
    await expect(announceDraftedPlans([], "site-1")).resolves.toBe(false);

    expect(mockPresentNow).not.toHaveBeenCalled();
  });

  it("sends ONE notification for a batch, not one per plan", async () => {
    await announceDraftedPlans([plan("rec-1"), plan("rec-2"), plan("rec-3")], "site-1");

    expect(mockPresentNow).toHaveBeenCalledTimes(1);
  });

  it("counts the batch in the body", async () => {
    await announceDraftedPlans([plan("rec-1"), plan("rec-2")], "site-1");

    expect(mockPresentNow.mock.calls[0][1]).toContain('"count":2');
  });

  it("carries site, shift and plan for a single plan, because the route needs all three", async () => {
    /*
     * The detail route is nested under site and shift — a recommendation id alone cannot be
     * fetched or decided on, so a notification carrying only the id would open a screen with
     * nothing on it.
     */
    await announceDraftedPlans([plan("rec-1")], "site-1");

    expect(mockPresentNow.mock.calls[0][2]).toEqual({
      kind: "plan-drafted",
      siteId: "site-1",
      shiftId: "shift-for-rec-1",
      recommendationId: "rec-1",
    });
  });

  it("carries no plan for a batch, so the tap lands on the list", async () => {
    /*
     * Picking the first arbitrarily would drop a supervisor into one of three decisions with
     * no sign the other two exist — worse than landing on the list that shows all of them.
     */
    await announceDraftedPlans([plan("rec-1"), plan("rec-2")], "site-1");

    const data = mockPresentNow.mock.calls[0][2];
    expect(data).toEqual({ kind: "plan-drafted" });
    expect(data).not.toHaveProperty("recommendationId");
  });

  it("reports back whether anything was actually sent", async () => {
    // The listener uses this only for logging; it records the ids either way, deliberately.
    mockPresentNow.mockResolvedValueOnce(false);

    await expect(announceDraftedPlans([plan("rec-1")], "site-1")).resolves.toBe(false);
  });
});
