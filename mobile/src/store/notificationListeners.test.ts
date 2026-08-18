/**
 * The two rules that fail silently, and produce a WRONG notification rather than a missing one.
 *
 *   Cancellation      A rest that is called off leaves a notification sitting in the OS, ready
 *                     to buzz "your rest is over" for a rest that never happened. That is worse
 *                     than sending nothing: it is a safety app telling a worker a falsehood
 *                     about their own break, and they cannot tell it apart from a true one.
 *
 *   First-load seed   Without it, the first poll after signing in treats every plan already on
 *                     the site as new, and the supervisor's phone fires a burst of
 *                     notifications for plans drafted days ago.
 *
 * Neither shows up in a manual pass — the first needs a cancelled rest, the second needs a
 * fresh install with existing plans — so both are pinned here.
 *
 * The listener is exercised through a real store rather than called directly, because what is
 * being tested is that it runs at all on each of these actions. A direct call would pass
 * happily against a middleware nobody had registered.
 *
 * @author Justin Chua
 */
import { configureStore } from "@reduxjs/toolkit";

interface RestRequest {
  dispatchId: string;
  startedAt: number;
  dismissAt: number;
}

const mockScheduleRest = jest.fn((_request: RestRequest) => Promise.resolve());
const mockCancelRest = jest.fn((_dispatchId: string) => Promise.resolve());
const mockCancelAll = jest.fn(() => Promise.resolve());
const mockAnnounce = jest.fn((_plans: { id: string }[], _siteId: string) =>
  Promise.resolve(true),
);

jest.mock("@/notifications/restNotifications", () => ({
  scheduleRestEndNotification: (request: RestRequest) => mockScheduleRest(request),
  cancelRestEndNotification: (dispatchId: string) => mockCancelRest(dispatchId),
}));
jest.mock("@/notifications/notificationClient", () => ({
  cancelAllScheduled: () => mockCancelAll(),
}));
jest.mock("@/notifications/planNotifications", () => ({
  announceDraftedPlans: (plans: { id: string }[], siteId: string) => mockAnnounce(plans, siteId),
  isAwaitingDecision: (plan: { status: string }) => plan.status === "PENDING_APPROVAL",
}));

import { notificationListener } from "./notificationListeners";
import notificationsReducer from "./reducers/notificationsSlice";
import { acknowledge, dismissed, resetAcknowledgements } from "./reducers/dispatchInboxSlice";
import { loadRecommendations } from "./reducers/recommendationsSlice";
import { signOut } from "./reducers/authSlice";
import type { CurrentUser, Recommendation } from "@/types/domain";

const SUPERVISOR: CurrentUser = {
  id: "sup-1",
  username: "supervisor1",
  displayName: "Supervisor One",
  role: "SUPERVISOR",
  siteIds: ["site-1"],
};
const WORKER: CurrentUser = { ...SUPERVISOR, id: "w-1", role: "WORKER" };

const ACKNOWLEDGED_AT = "2026-08-18T02:00:00.000Z";

interface StoreOptions {
  user?: CurrentUser | null;
  muted?: boolean;
  plansListFocused?: boolean;
  seenPlanIdsByUser?: Record<string, string[]>;
  acknowledged?: Record<string, unknown>;
}

function buildStore(options: StoreOptions = {}) {
  const {
    user = SUPERVISOR,
    muted = false,
    plansListFocused = false,
    seenPlanIdsByUser = {},
    acknowledged = {},
  } = options;

  return configureStore({
    reducer: {
      notifications: notificationsReducer,
      auth: (state = { user } as unknown) => state,
      preferences: (state = { notificationsMuted: muted } as unknown) => state,
      ui: (state = { plansListFocused } as unknown) => state,
      dispatchInbox: (state = { acknowledged } as unknown) => state,
    },
    preloadedState: { notifications: { seenPlanIdsByUser } },
    middleware: (getDefault) => getDefault().prepend(notificationListener.middleware),
  });
}

function plan(id: string, overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id,
    shiftId: "shift-1",
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

/** The middleware's effects are async; this lets the microtask queue drain before asserting. */
const settle = () => new Promise<void>((resolve) => setImmediate(() => resolve()));

beforeEach(() => jest.clearAllMocks());

/* ───────────────────────────── The worker's rest ───────────────────────────── */

describe("scheduling a rest notification", () => {
  const restRecord = {
    acknowledgedAt: ACKNOWLEDGED_AT,
    dismissAt: Date.parse(ACKNOWLEDGED_AT) + 10 * 60_000,
    hasRestTimer: true,
  };

  it("schedules when a real rest is acknowledged", async () => {
    const store = buildStore({ user: WORKER, acknowledged: { d1: restRecord } });

    store.dispatch({ type: acknowledge.fulfilled.type, meta: { arg: { dispatchId: "d1" } } });
    await settle();

    expect(mockScheduleRest).toHaveBeenCalledWith({
      dispatchId: "d1",
      startedAt: Date.parse(ACKNOWLEDGED_AT),
      dismissAt: restRecord.dismissAt,
    });
  });

  it("schedules nothing for a card that is merely being tidied away", async () => {
    /*
     * A HYDRATE card and an unparseable duration both get a three-minute dwell and both have
     * `hasRestTimer` false. Neither is a rest the worker served, so "your rest is over" would
     * be telling them about a break they never took.
     */
    const store = buildStore({
      user: WORKER,
      acknowledged: { d1: { ...restRecord, hasRestTimer: false } },
    });

    store.dispatch({ type: acknowledge.fulfilled.type, meta: { arg: { dispatchId: "d1" } } });
    await settle();

    expect(mockScheduleRest).not.toHaveBeenCalled();
  });

  it("schedules nothing while notifications are muted", async () => {
    const store = buildStore({ user: WORKER, muted: true, acknowledged: { d1: restRecord } });

    store.dispatch({ type: acknowledge.fulfilled.type, meta: { arg: { dispatchId: "d1" } } });
    await settle();

    expect(mockScheduleRest).not.toHaveBeenCalled();
  });
});

describe("cancelling a rest notification", () => {
  it("cancels when the card is dismissed", async () => {
    const store = buildStore({ user: WORKER });

    store.dispatch(dismissed("d1"));
    await settle();

    expect(mockCancelRest).toHaveBeenCalledWith("d1");
  });

  it.each([
    ["a dev reset", resetAcknowledgements()],
    ["signing out", { type: signOut.fulfilled.type }],
    ["a sign-out that failed but still cleared the session", { type: signOut.rejected.type }],
  ])("cancels everything on %s", async (_name, action) => {
    /*
     * Sign-out matters most and is not an edge case on a shared site phone: without it, the
     * next worker to pick up the handset is buzzed about the previous worker's rest, naming a
     * duration they never took.
     *
     * The rejected case is included deliberately — `authSlice` clears the session there too,
     * on the reasoning that someone who asked to leave leaves regardless.
     */
    const store = buildStore({ user: WORKER });

    store.dispatch(action);
    await settle();

    expect(mockCancelAll).toHaveBeenCalled();
  });
});

/* ───────────────────────── The supervisor's drafted plans ───────────────────────── */

describe("announcing drafted plans", () => {
  const loaded = (plans: Recommendation[]) => ({
    type: loadRecommendations.fulfilled.type,
    payload: plans,
    meta: { arg: { siteId: "site-1" } },
  });

  it("announces nothing on the first load, and records what was there", async () => {
    const store = buildStore();

    store.dispatch(loaded([plan("rec-1"), plan("rec-2")]));
    await settle();

    expect(mockAnnounce).not.toHaveBeenCalled();
    expect(store.getState().notifications.seenPlanIdsByUser["sup-1"]).toEqual(["rec-1", "rec-2"]);
  });

  it("announces a plan that was not there on the previous poll", async () => {
    const store = buildStore({ seenPlanIdsByUser: { "sup-1": ["rec-1"] } });

    store.dispatch(loaded([plan("rec-1"), plan("rec-2")]));
    await settle();

    expect(mockAnnounce).toHaveBeenCalledWith([expect.objectContaining({ id: "rec-2" })], "site-1");
  });

  it("stays quiet when the same plans come back", async () => {
    const store = buildStore({ seenPlanIdsByUser: { "sup-1": ["rec-1"] } });

    store.dispatch(loaded([plan("rec-1")]));
    await settle();

    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it("does not announce the same plan twice across polls", async () => {
    const store = buildStore({ seenPlanIdsByUser: { "sup-1": [] } });

    store.dispatch(loaded([plan("rec-1")]));
    await settle();
    store.dispatch(loaded([plan("rec-1")]));
    await settle();

    expect(mockAnnounce).toHaveBeenCalledTimes(1);
  });

  it("ignores a plan that is not awaiting a decision", async () => {
    // The auto-trigger supersedes its own drafts between polls, so this is a real case. A
    // plan that is not asking for a decision has no action attached to interrupt someone for.
    const store = buildStore({ seenPlanIdsByUser: { "sup-1": [] } });

    store.dispatch(loaded([plan("rec-1", { status: "SUPERSEDED" })]));
    await settle();

    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it.each([
    ["a worker", WORKER],
    ["a safety manager", { ...SUPERVISOR, role: "SAFETY_MANAGER" } as CurrentUser],
  ])("announces nothing to %s", async (_name, user) => {
    const store = buildStore({ user, seenPlanIdsByUser: { [user.id]: [] } });

    store.dispatch(loaded([plan("rec-1")]));
    await settle();

    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it("stays quiet while the supervisor is looking at the plans list", async () => {
    /*
     * The list already announces an arriving plan with a toast. Firing the notification too
     * would report one event twice, half a second apart, to someone whose eyes are on the row.
     */
    const store = buildStore({
      seenPlanIdsByUser: { "sup-1": [] },
      plansListFocused: true,
    });

    store.dispatch(loaded([plan("rec-1")]));
    await settle();

    expect(mockAnnounce).not.toHaveBeenCalled();
    // Still recorded, or it would be announced later as though it were new — it was
    // announced, just by the toast rather than by the OS.
    expect(store.getState().notifications.seenPlanIdsByUser["sup-1"]).toEqual(["rec-1"]);
  });

  it("records a plan even when the notification could not be sent", async () => {
    /*
     * The alternative sounds more careful and is worse. With permission refused, announcing
     * always fails — so recording only on success would leave the same plans "new" on every
     * poll forever, and the moment permission was granted the supervisor would be buzzed for
     * every plan drafted since they refused.
     */
    mockAnnounce.mockResolvedValueOnce(false);
    const store = buildStore({ seenPlanIdsByUser: { "sup-1": [] } });

    store.dispatch(loaded([plan("rec-1")]));
    await settle();

    expect(store.getState().notifications.seenPlanIdsByUser["sup-1"]).toEqual(["rec-1"]);
  });

  it("keeps one supervisor's seen-set away from another's", async () => {
    // Site phones are shared. Inheriting a colleague's set would silently swallow every plan
    // drafted during their shift — the case where the notification mattered most.
    const store = buildStore({ seenPlanIdsByUser: { "other-sup": ["rec-1"] } });

    store.dispatch(loaded([plan("rec-1")]));
    await settle();

    // Seeds for this user rather than treating the colleague's record as their own.
    expect(mockAnnounce).not.toHaveBeenCalled();
    expect(store.getState().notifications.seenPlanIdsByUser["sup-1"]).toEqual(["rec-1"]);
  });
});
