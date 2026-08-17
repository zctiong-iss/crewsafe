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
 */
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

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

const DECIDED = plan("rec-2", {
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
  mockFetchShifts.mockResolvedValue([{ id: "shift-1" }]);
  mockFetchRecommendations.mockResolvedValue([plan("rec-1"), DECIDED]);
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

it("falls back to the raw id when a decider cannot be resolved to a name", async () => {
  // GET /workers returns ACTIVE only, so someone since offboarded resolves to nothing.
  // Dropping the badge would understate who decided.
  mockFetchRecommendations.mockResolvedValue([
    plan("rec-3", {
      status: "APPROVED",
      approval: {
        id: "ap-2",
        approverId: "gone",
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

  await waitFor(() => expect(getByText("gone")).toBeTruthy());
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
