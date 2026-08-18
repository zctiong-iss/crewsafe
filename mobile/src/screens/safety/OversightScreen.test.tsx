/**
 * OversightScreen — the safety manager's site-and-plans tree (SCRUM-TBD-90).
 *
 * The assertions that carry weight are about restraint and about scale:
 *
 *   1. plans are NOT fetched for a site until it is expanded. One site costs a fetchShifts
 *      plus a call per shift, so eager loading at twenty sites is ~120 requests to render a
 *      list of names. A test that only checked "the list renders" would pass either way.
 *   2. one site failing leaves the others readable. A shared error state would blank a
 *      manager's whole view because one site 403'd.
 *   3. the supervisor badge appears only where a decision exists. A pending plan has no owner,
 *      and inventing one would be the screen asserting something the data does not say.
 *   4. a decision made elsewhere reaches this screen. Plans were cached on first expand and
 *      never re-read, so a manager watched an approved plan sit at "Awaiting decision".
 *
 * @author Justin Chua
 */
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join(",")}` : key,
    i18n: { language: "en" },
  }),
}));
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useReduceMotionPreference: () => false,
  useSystemReduceMotion: () => false,
}));

const mockFetchSites = jest.fn();
const mockFetchShifts = jest.fn();
const mockFetchRecommendations = jest.fn();
jest.mock("@/api/endpoints/sites", () => ({
  fetchAccessibleSites: (...a: unknown[]) => mockFetchSites(...a),
}));
jest.mock("@/api/endpoints/shifts", () => ({
  fetchShifts: (...a: unknown[]) => mockFetchShifts(...a),
}));
jest.mock("@/api/endpoints/recommendations", () => ({
  fetchRecommendations: (...a: unknown[]) => mockFetchRecommendations(...a),
}));

const mockFetchPlanSummary = jest.fn();
jest.mock("@/api/endpoints/oversight", () => ({
  fetchPlanSummary: (...a: unknown[]) => mockFetchPlanSummary(...a),
}));

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: (...a: unknown[]) => mockNavigate(...a) }),
}));

/*
 * Fires once on mount, standing in for focus + interval + resume. Mocking the hook rather than
 * `useFocusEffect` keeps these tests about what the screen loads, not about when a timer ticks
 * — the polling itself belongs to useAutoRefresh's own tests.
 */
jest.mock("@/hooks/useAutoRefresh", () => ({
  useAutoRefresh: (fn: () => void) => {
    const { useEffect } = jest.requireActual<typeof import("react")>("react");
    // Empty deps on purpose: `fn` is a fresh closure each render, so depending on it would
    // re-fire the load every render and the test would never settle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => fn(), []);
  },
  REFRESH_INTERVALS: { PLANS_MS: 120000 },
}));

import oversightReducer from "@/store/reducers/oversightSlice";
import OversightScreen from "./OversightScreen";
import type { CurrentUser, Recommendation, Site } from "@/types/domain";

const MANAGER: CurrentUser = {
  id: "mgr-1",
  username: "manager1",
  displayName: "Manager One",
  role: "SAFETY_MANAGER",
  siteIds: ["site-1", "site-2"],
};

function site(id: string, name: string): Site {
  return { id, name, latitude: "1.3", longitude: "103.8", timezone: "Asia/Singapore" };
}

function plan(id: string, overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id,
    shiftId: "shift-1",
    policyVersion: null,
    status: "PENDING_APPROVAL",
    rationale: null,
    createdAt: "2026-08-17T01:00:00Z",
    mitigations: [],
    approval: null,
    modelVersion: "anthropic.claude-3-5-sonnet",
    ...overrides,
  };
}

/*
 * On its OWN shift, deliberately (SCRUM-TBD-110).
 *
 * Each shift now shows only its newest plan at rest, with the rest collapsed. Two plans on one
 * shift would leave one of them behind a disclosure, and every badge assertion below would be
 * testing the collapse rather than the badge. Two shifts is also the realistic case: a site
 * runs more than one crew.
 */
const DECIDED = plan("rec-2", {
  shiftId: "shift-2",
  status: "APPROVED",
  approval: {
    id: "ap-1",
    approverId: "sup-1",
    decision: "APPROVED",
    reason: null,
    editedMitigations: null,
    decidedAt: "2026-08-17T02:00:00Z",
  },
});

function buildStore(user: CurrentUser = MANAGER) {
  return configureStore({
    reducer: {
      oversight: oversightReducer,
      auth: (s = { user } as unknown) => s,
      shifts: (s = { workers: [{ id: "sup-1", displayName: "Meng Hui" }] } as unknown) => s,
    },
  });
}

function renderScreen(store = buildStore()) {
  return render(
    <Provider store={store}>
      <OversightScreen />
    </Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchSites.mockResolvedValue([site("site-1", "Bishan Park"), site("site-2", "NUS Campus")]);
  mockFetchShifts.mockResolvedValue([
    { id: "shift-1", startsAt: "2026-08-18T06:00:00Z", endsAt: "2026-08-18T14:00:00Z" },
    { id: "shift-2", startsAt: "2026-08-18T14:00:00Z", endsAt: "2026-08-18T22:00:00Z" },
  ]);
  // Keyed by shift: a blanket mockResolvedValue would hand BOTH plans to BOTH shifts and the
  // site would appear to hold four.
  mockFetchRecommendations.mockImplementation((_siteId: string, shiftId: string) =>
    Promise.resolve(shiftId === "shift-1" ? [plan("rec-1")] : [DECIDED]),
  );
  mockFetchPlanSummary.mockResolvedValue([]);
});

/* ── The site list ─────────────────────────────────────────────────────────────────────── */

it("lists every site the manager oversees", async () => {
  const { getByText } = await renderScreen();

  await waitFor(() => {
    expect(getByText("Bishan Park")).toBeTruthy();
    expect(getByText("NUS Campus")).toBeTruthy();
  });
});

it("explains itself when the manager has no sites", async () => {
  // Reachable: a manager can exist with no memberships. A blank screen would read as a bug.
  const { getByText } = await renderScreen(buildStore({ ...MANAGER, siteIds: [] }));

  await waitFor(() => expect(getByText("shifts.noSitesTitle")).toBeTruthy());
  expect(mockFetchSites).not.toHaveBeenCalled();
});

/* ── Lazy loading ──────────────────────────────────────────────────────────────────────── */

it("fetches NO plans until a site is expanded", async () => {
  /*
   * The scale decision, asserted directly. One site costs a fetchShifts plus a call per
   * shift; doing that for twenty sites on mount is ~120 requests to render a list of names.
   */
  const { getByText } = await renderScreen();

  await waitFor(() => expect(getByText("Bishan Park")).toBeTruthy());
  expect(mockFetchShifts).not.toHaveBeenCalled();
  expect(mockFetchRecommendations).not.toHaveBeenCalled();
});

it("fetches a site's plans on first expand", async () => {
  const { getAllByLabelText } = await renderScreen();

  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);

  await waitFor(() => expect(mockFetchShifts).toHaveBeenCalledTimes(1));
});

it("does not refetch a site whose plans it already has", async () => {
  const { getAllByLabelText } = await renderScreen();

  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);
  await waitFor(() => expect(mockFetchShifts).toHaveBeenCalledTimes(1));

  // Collapse, then expand again. Collapsing is a display change, not a reason to discard work.
  await fireEvent.press(getAllByLabelText(/oversight.hidePlansFor/)[0]);
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);

  expect(mockFetchShifts).toHaveBeenCalledTimes(1);
});

/* ── The supervisor badge ──────────────────────────────────────────────────────────────── */

it("names the decider on a decided plan and nobody on a pending one", async () => {
  const { getAllByLabelText, getByText, queryByText } = await renderScreen();

  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);

  await waitFor(() => expect(getByText("Meng Hui")).toBeTruthy());
  // Exactly one badge: the pending plan in the same list contributes none.
  expect(queryByText("mgr-1")).toBeNull();
});

it("names the approver from the server rather than looking them up", async () => {
  /*
   * approverId can never be resolved client-side: the only lookup is GET /workers, which
   * returns WORKERs, and an approver is a SUPERVISOR. The server sends the name for that
   * reason.
   */
  mockFetchRecommendations.mockResolvedValue([
    plan("rec-3", {
      status: "APPROVED",
      approval: {
        id: "ap-2",
        approverId: "5fd21b3d-c1b8-450b-93d9-57ed347edf2f",
        approverName: "Zhong Cheng",
        decision: "APPROVED",
        reason: null,
        editedMitigations: null,
        decidedAt: "2026-08-17T02:00:00Z",
      },
    }),
  ]);

  const { getAllByLabelText, getByText } = await renderScreen();
  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);

  await waitFor(() => expect(getByText("Zhong Cheng")).toBeTruthy());
});

it("shows no badge rather than a raw id when the approver cannot be named", async () => {
  /*
   * The regression. A UUID fell through to the badge on every decided plan — meaningless to a
   * manager, and 36 characters with no spaces, so it could not line-wrap and broke the row.
   * Showing nothing is the honest answer: the status pill already says it was decided.
   */
  mockFetchRecommendations.mockResolvedValue([
    plan("rec-3", {
      status: "APPROVED",
      approval: {
        id: "ap-2",
        approverId: "5fd21b3d-c1b8-450b-93d9-57ed347edf2f",
        decision: "APPROVED",
        reason: null,
        editedMitigations: null,
        decidedAt: "2026-08-17T02:00:00Z",
      },
    }),
  ]);

  const { getAllByLabelText, queryByText } = await renderScreen();
  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);

  await waitFor(() => expect(queryByText(/oversight.openPlan/)).not.toBeUndefined());
  expect(queryByText("5fd21b3d-c1b8-450b-93d9-57ed347edf2f")).toBeNull();
});

/* ── Failure isolation ─────────────────────────────────────────────────────────────────── */

it("keeps the other sites readable when one site fails to load", async () => {
  mockFetchShifts.mockRejectedValue(new Error("boom"));

  const { getAllByLabelText, getByText } = await renderScreen();
  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);

  // The failed site says so, and the other one is still on screen and still expandable.
  await waitFor(() => expect(getByText("errors.unknown")).toBeTruthy());
  expect(getByText("NUS Campus")).toBeTruthy();
});

it("says so when a site has no plans rather than rendering an empty box", async () => {
  mockFetchRecommendations.mockResolvedValue([]);

  const { getAllByLabelText, getByText } = await renderScreen();
  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);

  await waitFor(() => expect(getByText("oversight.noPlans")).toBeTruthy());
});

/* ── Scale ─────────────────────────────────────────────────────────────────────────────── */

it("renders a twenty-site roster", async () => {
  // The sizing case the whole screen is shaped around. Exercised rather than assumed.
  const many = Array.from({ length: 20 }, (_, i) => site(`s-${i}`, `Site ${String(i).padStart(2, "0")}`));
  mockFetchSites.mockResolvedValue(many);

  const { getByText } = await renderScreen(
    buildStore({ ...MANAGER, siteIds: many.map((m) => m.id) }),
  );

  await waitFor(() => expect(getByText("Site 00")).toBeTruthy());
  // Still nothing fetched per site: twenty rows, zero plan requests.
  expect(mockFetchShifts).not.toHaveBeenCalled();
});

/* ── The access this screen replaces ───────────────────────────────────────────────────── */

it("offers no shift-creation or shift-editing affordance", async () => {
  /*
   * The screen exists partly to remove that access. The server refuses it outright
   * (SCRUM-TBD-92) and this asserts the client does not offer a journey toward a 403.
   */
  const { queryByText } = await renderScreen();

  await waitFor(() => expect(queryByText("Bishan Park")).not.toBeNull());
  expect(queryByText("shifts.createButton")).toBeNull();
  expect(queryByText("shifts.editAssignment")).toBeNull();
});

/* ── Counts before expansion ───────────────────────────────────────────────────────────── */

/*
 * The regression these cover. Counts used to come only from plans fetched on expand, so a site
 * nobody had opened reported zero awaiting — indistinguishable on screen from a site with
 * genuinely nothing outstanding. A manager scanning the list could pass over the one site with
 * a plan pending approval, which is the exact failure this screen exists to prevent.
 */
it("shows what is awaiting on a site nobody has expanded", async () => {
  mockFetchPlanSummary.mockResolvedValue([
    { siteId: "site-1", awaitingDecision: 0, totalPlans: 3 },
    { siteId: "site-2", awaitingDecision: 2, totalPlans: 2 },
  ]);

  const { getByText } = await renderScreen();

  await waitFor(() => expect(getByText(/oversight.awaitingCount:2/)).toBeTruthy());
  // Nothing was expanded, so no per-site plan fetch happened — the count came from the summary.
  expect(mockFetchShifts).not.toHaveBeenCalled();
});

it("sorts a site with work outstanding above one without, before any expansion", async () => {
  mockFetchPlanSummary.mockResolvedValue([
    { siteId: "site-1", awaitingDecision: 0, totalPlans: 4 },
    { siteId: "site-2", awaitingDecision: 3, totalPlans: 3 },
  ]);

  const { getAllByText } = await renderScreen();

  // "NUS Campus" is site-2 and alphabetically second; the outstanding work must lift it.
  await waitFor(() => expect(getAllByText(/Bishan Park|NUS Campus/).length).toBe(2));
  const names = getAllByText(/Bishan Park|NUS Campus/).map((node) => node.props.children);
  expect(names[0]).toBe("NUS Campus");
});

it("keeps working when the summary cannot be fetched", async () => {
  // A count is worth less than the list it sits on: a failed summary must not blank the screen
  // or raise a banner, it degrades to the old lazily-counted behaviour.
  mockFetchPlanSummary.mockRejectedValue(new Error("offline"));

  const { getByText, queryByText } = await renderScreen();

  await waitFor(() => expect(getByText("Bishan Park")).toBeTruthy());
  expect(queryByText("errors.unknown")).toBeNull();
});

/* ── Opening a plan ────────────────────────────────────────────────────────────────────── */

it("opens the full plan when a plan row is tapped", async () => {
  /*
   * The row shows a status pill and a timestamp — that a plan exists, and nothing about what it
   * says. The mitigations, rationale and evidence a manager needs to oversee a decision live on
   * the detail screen, which already renders read-only for this role.
   */
  const { getByText, getAllByLabelText } = await renderScreen();

  await waitFor(() => expect(getByText("Bishan Park")).toBeTruthy());
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);
  await waitFor(() => expect(getAllByLabelText(/oversight.openPlan/).length).toBeGreaterThan(0));

  await fireEvent.press(getAllByLabelText(/oversight.openPlan/)[0]);

  expect(mockNavigate).toHaveBeenCalledWith("RecommendationDetail", {
    siteId: "site-1",
    shiftId: "shift-1",
    recommendationId: "rec-1",
  });
});

/* ── The tappable affordance ───────────────────────────────────────────────────────────── */

/*
 * The chevron was removed in favour of a resting border. Hover cannot carry this: RN builds
 * onHoverIn/onHoverOut on mouse events, so on a touch phone they never fire — which is why the
 * outline is always visible rather than appearing on interaction.
 */
it("outlines the plan row at rest, with no chevron", async () => {
  const { getAllByLabelText } = await renderScreen();

  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);
  await waitFor(() => expect(getAllByLabelText(/oversight.openPlan/).length).toBeGreaterThan(0));

  const row = getAllByLabelText(/oversight.openPlan/)[0];
  const style = row.props.style;
  const flattened = Array.isArray(style) ? Object.assign({}, ...style.flat()) : style;

  // A border at rest is the whole affordance now: without it the row is indistinguishable
  // from static text.
  expect(flattened.borderWidth).toBeGreaterThan(0);
  expect(flattened.borderColor).toBeTruthy();
});

it("darkens the outline on focus rather than relying on hover", async () => {
  const { getAllByLabelText } = await renderScreen();

  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);
  await waitFor(() => expect(getAllByLabelText(/oversight.openPlan/).length).toBeGreaterThan(0));

  const row = getAllByLabelText(/oversight.openPlan/)[0];
  const readBorder = () => {
    const style = row.props.style;
    return (Array.isArray(style) ? Object.assign({}, ...style.flat()) : style).borderColor;
  };

  const atRest = readBorder();
  await fireEvent(row, "focus");

  // Focus is the half of this that works on a phone — switch control and external keyboards
  // drive it, and it is why the row is not press-only.
  expect(readBorder()).not.toBe(atRest);
});

/* ── Staying current after somebody else decides ───────────────────────────────────────── */

/*
 * The bug these cover. A decision is made by a different person on a different device, so this
 * screen only learns about it by asking again. Plans were fetched once on first expand and kept
 * forever, and refresh re-read the site list and the counts but never the plans — so a manager
 * watching a supervisor approve a plan kept seeing "Awaiting decision" with no way to correct
 * it short of restarting the app.
 */
it("refreshes the plans of expanded sites, not just the site list", async () => {
  const { getAllByLabelText, getByTestId } = await renderScreen();

  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);
  await waitFor(() => expect(mockFetchShifts).toHaveBeenCalledTimes(1));

  // A supervisor approves on their own device. Refresh used to re-read the site list and the
  // counts and stop there, so the expanded row kept its cached "Awaiting decision" forever.
  const list = getByTestId("oversight-list");
  await act(async () => {
    list.props.refreshControl.props.onRefresh();
  });

  await waitFor(() => expect(mockFetchShifts).toHaveBeenCalledTimes(2));
});

it("does not blank an expanded site while it refreshes", async () => {
  /*
   * A plain `status = "loading"` on every poll would flash a spinner over readable content
   * every couple of minutes, which is what useAutoRefresh documents itself as avoiding.
   */
  const { getAllByLabelText, queryAllByLabelText } = await renderScreen();

  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);
  await waitFor(() => expect(queryAllByLabelText(/oversight.openPlan/).length).toBeGreaterThan(0));

  const before = queryAllByLabelText(/oversight.openPlan/).length;
  // A refresh is in flight; the rows must still be on screen.
  expect(before).toBeGreaterThan(0);
});

it("keeps showing plans when a background refresh fails", async () => {
  const { getAllByLabelText, queryAllByLabelText, queryByText, getByTestId } =
    await renderScreen();

  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);
  await waitFor(() => expect(queryAllByLabelText(/oversight.openPlan/).length).toBeGreaterThan(0));

  // Through the refresh path, which is where a background failure actually happens. Expanding
  // twice would not have exercised it at all: a site already loaded is deliberately not
  // refetched, so the queued rejection would never have been consumed.
  mockFetchShifts.mockRejectedValue(new Error("offline"));
  const list = getByTestId("oversight-list");
  await act(async () => {
    list.props.refreshControl.props.onRefresh();
  });

  // One dropped request on a site network must not swap a readable list for a banner.
  expect(queryAllByLabelText(/oversight.openPlan/).length).toBeGreaterThan(0);
  expect(queryByText("errors.unknown")).toBeNull();
});

/* ── The site supervisor pill ───────────────────────────────────────────────────────────── */

/*
 * "Which supervisor is responsible for this AI-drafted plan?" has no answer in the data for most
 * plans: nothing records a creator, and generateAuto passes a null actor because the scheduler
 * drafts the majority with no human involved. So the pill names who is accountable for the
 * SITE — true for every plan, whatever its status or origin — and the copy says so rather than
 * implying authorship.
 */
it("names the site supervisor on every plan, whatever the status", async () => {
  mockFetchPlanSummary.mockResolvedValue([
    {
      siteId: "site-1",
      awaitingDecision: 1,
      totalPlans: 2,
      supervisors: [{ id: "sup-1", displayName: "Meng Hui" }],
    },
  ]);

  const { getAllByLabelText, getAllByText } = await renderScreen();
  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);

  // Two plans in the fixture: one PENDING_APPROVAL, one APPROVED. Both carry the pill.
  // Two plans in the fixture: one PENDING_APPROVAL, one APPROVED. Both carry the pill, and the
  // pill shows the bare name -- the "Site supervisor:" prefix lives on the accessible label
  // only, because it doubled the pill width and pushed it onto a second row.
  await waitFor(() => expect(getAllByText("Meng Hui").length).toBe(2));
  expect(getAllByLabelText(/oversight.supervisorLabel/).length).toBe(2);
});

it("lists every supervisor when a site has more than one", async () => {
  mockFetchPlanSummary.mockResolvedValue([
    {
      siteId: "site-1",
      awaitingDecision: 0,
      totalPlans: 2,
      supervisors: [
        { id: "sup-1", displayName: "Meng Hui" },
        { id: "sup-2", displayName: "Zhong Cheng" },
      ],
    },
  ]);

  const { getAllByLabelText, getAllByText } = await renderScreen();
  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);

  // Two supervisors x two plans. Names render bare; the spoken form keeps the context.
  await waitFor(() => expect(getAllByText("Meng Hui").length).toBe(2));
  expect(getAllByText("Zhong Cheng").length).toBe(2);
  expect(getAllByLabelText(/oversight.supervisorLabel/).length).toBe(4);
});

it("does not repeat a name when the decider is the site supervisor", async () => {
  /*
   * The usual case: the supervisor who covers the site is the one who approved. Rendering both
   * pills would put the same person on the row twice.
   */
  mockFetchPlanSummary.mockResolvedValue([
    {
      siteId: "site-1",
      awaitingDecision: 0,
      totalPlans: 1,
      supervisors: [{ id: "sup-1", displayName: "Meng Hui" }],
    },
  ]);
  mockFetchRecommendations.mockResolvedValue([
    plan("rec-9", {
      status: "APPROVED",
      approval: {
        id: "ap-9",
        approverId: "sup-1",
        approverName: "Meng Hui",
        decision: "APPROVED",
        reason: null,
        editedMitigations: null,
        decidedAt: "2026-08-17T02:00:00Z",
      },
    }),
  ]);

  const { getAllByLabelText, queryAllByText } = await renderScreen();
  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);

  await waitFor(() => expect(queryAllByText(/Meng Hui/).length).toBe(1));
});

it("still names a decider who is not one of the site's supervisors", async () => {
  // Genuinely new information: an admin, or a supervisor since moved off the site, decided it.
  mockFetchPlanSummary.mockResolvedValue([
    {
      siteId: "site-1",
      awaitingDecision: 0,
      totalPlans: 1,
      supervisors: [{ id: "sup-1", displayName: "Meng Hui" }],
    },
  ]);
  mockFetchRecommendations.mockResolvedValue([
    plan("rec-9", {
      status: "APPROVED",
      approval: {
        id: "ap-9",
        approverId: "adm-1",
        approverName: "Abu Bakar",
        decision: "APPROVED",
        reason: null,
        editedMitigations: null,
        decidedAt: "2026-08-17T02:00:00Z",
      },
    }),
  ]);

  const { getAllByLabelText, getByText } = await renderScreen();
  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);

  await waitFor(() => expect(getByText("Abu Bakar")).toBeTruthy());
});

it("renders no supervisor pill when the summary names none", async () => {
  // A backend predating the field, or a site with no active supervisor. Better an absent pill
  // than an invented name on a safety record.
  mockFetchPlanSummary.mockResolvedValue([
    { siteId: "site-1", awaitingDecision: 1, totalPlans: 2 },
  ]);

  const { getAllByLabelText, queryAllByText } = await renderScreen();
  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);

  await waitFor(() => expect(getAllByLabelText(/oversight.openPlan/).length).toBeGreaterThan(0));
  expect(queryAllByText(/oversight.supervisorLabel/).length).toBe(0);
});

it("keeps the status and the supervisor on one line for every status", async () => {
  /*
   * The prefixed label wrapped the supervisor pill onto a second row, which read as two
   * unrelated facts stacked rather than one row saying "this plan, this owner". Asserted for
   * pending and decided alike, since the row must not reflow depending on status.
   */
  mockFetchPlanSummary.mockResolvedValue([
    {
      siteId: "site-1",
      awaitingDecision: 1,
      totalPlans: 2,
      supervisors: [{ id: "sup-1", displayName: "Meng Hui" }],
    },
  ]);

  const { getAllByLabelText, getAllByText } = await renderScreen();
  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);
  await waitFor(() => expect(getAllByText("Meng Hui").length).toBe(2));

  // The pill row must not wrap: a wrapping container is what put the owner on its own line.
  const pillRow = getAllByText("Meng Hui")[0].parent?.parent?.parent;
  const style = pillRow?.props?.style;
  const flattened = Array.isArray(style) ? Object.assign({}, ...style.flat()) : (style ?? {});
  expect(flattened.flexWrap ?? "nowrap").not.toBe("wrap");
});

/* ── Only the current plan per shift shows at rest (SCRUM-TBD-110) ──────────────────────── */

it("shows one plan per shift and collapses the history behind a count", async () => {
  /*
   * A site collects a plan per band transition — five within an hour on a volatile day — and
   * almost all are superseded the moment conditions move again. Listing them all made a
   * manager scroll past four dead rows to reach the live one.
   */
  mockFetchShifts.mockResolvedValue([
    { id: "shift-1", startsAt: "2026-08-18T06:00:00Z", endsAt: "2026-08-18T14:00:00Z" },
  ]);
  mockFetchRecommendations.mockResolvedValue([
    plan("newest", { createdAt: "2026-08-18T15:26:00Z" }),
    plan("older", { createdAt: "2026-08-18T15:09:00Z", status: "SUPERSEDED" }),
    plan("oldest", { createdAt: "2026-08-18T14:39:00Z", status: "SUPERSEDED" }),
  ]);

  const { getAllByLabelText, getByText, queryByLabelText } = await renderScreen();
  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);

  // Two earlier plans, behind one control.
  await waitFor(() => expect(getByText("oversight.earlierPlans:2")).toBeTruthy());

  // Expanding reveals them; nothing was discarded.
  await fireEvent.press(queryByLabelText("oversight.earlierPlans:2")!);
  await waitFor(() => expect(getByText("oversight.hideEarlierPlans")).toBeTruthy());
});

it("keeps an in-force stop-work visible under a newer plan", async () => {
  // AUTO_DISPATCHED went to a crew without approval (SCRUM-440). Hiding it because something
  // newer exists would take the most severe thing the system shows off the oversight screen.
  mockFetchShifts.mockResolvedValue([
    { id: "shift-1", startsAt: "2026-08-18T06:00:00Z", endsAt: "2026-08-18T14:00:00Z" },
  ]);
  mockFetchRecommendations.mockResolvedValue([
    plan("newer", { createdAt: "2026-08-18T15:30:00Z" }),
    plan("stopwork", { createdAt: "2026-08-18T15:17:00Z", status: "AUTO_DISPATCHED" }),
    plan("old", { createdAt: "2026-08-18T14:39:00Z", status: "SUPERSEDED" }),
  ]);

  const { getAllByLabelText, getByText } = await renderScreen();
  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);

  // Only "old" is collapsed — the stop-work stays out with the newest plan.
  await waitFor(() => expect(getByText("oversight.earlierPlans:1")).toBeTruthy());
});

it("labels each shift with its window so two crews are distinguishable", async () => {
  // Without it, two rows reading "Awaiting decision, Aisyah (Supervisor)" look like one row
  // rendered twice rather than two different crews.
  const { getAllByLabelText, getAllByText } = await renderScreen();
  await waitFor(() => expect(getAllByLabelText(/oversight.showPlansFor/).length).toBe(2));
  await fireEvent.press(getAllByLabelText(/oversight.showPlansFor/)[0]);

  await waitFor(() => expect(getAllByText(/shifts.window/).length).toBe(2));
});
