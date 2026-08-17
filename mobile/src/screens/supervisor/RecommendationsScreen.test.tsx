/**
 * RecommendationsScreen — the Plans tab (SCRUM-291 / SCRUM-TBD-70).
 *
 * This screen shipped untested. It is covered now because SCRUM-TBD-70 gave it behaviour worth
 * protecting: the server auto-drafts a plan when a WBGT band or lightning risk state
 * transitions, and this screen is the only thing that surfaces it.
 *
 * The two assertions that matter are both about restraint rather than about fetching:
 *
 *   1. the client NEVER asks the server to draft. `generateRecommendation` is a real 10-20s
 *      model call, and the server-side dedup that makes a band change supersede rather than
 *      stack lives behind the scheduler, not behind this endpoint. A poll that drafted would
 *      produce one plan per watching supervisor per transition.
 *   2. a poll must not land mid-decision. `items` is the FlatList's data, most-recently-drafted
 *      first, so a refresh can reorder the list under a thumb reaching for Approve.
 *
 * `useAutoRefresh` is captured rather than exercised: it owns focus/AppState behaviour and has
 * its own coverage, and running its real timer here would test React Navigation instead of this
 * screen. Holding the registered callback lets the guard be invoked directly.
 */
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { render, waitFor } from "@testing-library/react-native";

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
  useSystemReduceMotion: () => false,
}));

const mockAutoRefresh = jest.fn();
jest.mock("@/hooks/useAutoRefresh", () => ({
  useAutoRefresh: (cb: () => void, ms: number) => mockAutoRefresh(cb, ms),
  REFRESH_INTERVALS: { PLANS_MS: 60_000 },
}));

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

const mockFetchShifts = jest.fn().mockResolvedValue([]);
const mockFetchRecommendations = jest.fn().mockResolvedValue([]);
const mockGenerate = jest.fn();
jest.mock("@/api/endpoints/shifts", () => ({
  fetchShifts: (...args: unknown[]) => mockFetchShifts(...args),
}));
jest.mock("@/api/endpoints/recommendations", () => ({
  fetchRecommendations: (...args: unknown[]) => mockFetchRecommendations(...args),
  generateRecommendation: (...args: unknown[]) => mockGenerate(...args),
  decideRecommendation: jest.fn(),
}));

const mockShowToast = jest.fn((payload: unknown) => ({ type: "ui/showToast", payload }));
jest.mock("@/store/reducers/uiSlice", () => ({
  showToast: (payload: unknown) => mockShowToast(payload),
}));
jest.mock("@/store/reducers/shiftsSlice", () => ({
  loadShifts: () => ({ type: "shifts/noop" }),
}));

import recommendationsReducer, {
  type RecommendationsState,
} from "@/store/reducers/recommendationsSlice";
import RecommendationsScreen from "./RecommendationsScreen";
import type { CurrentUser, Recommendation } from "@/types/domain";

const SUPERVISOR: CurrentUser = {
  id: "sup-1",
  username: "supervisor1",
  displayName: "Supervisor One",
  role: "SUPERVISOR",
  siteIds: ["site-1"],
};

function recommendation(id: string, overrides: Partial<Recommendation> = {}): Recommendation {
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

function buildStore(items: Recommendation[], overrides: Partial<RecommendationsState> = {}) {
  const state: RecommendationsState = {
    status: "ready",
    items,
    errorKey: null,
    refreshing: false,
    decidingId: null,
    generating: false,
    ...overrides,
  };
  return configureStore({
    reducer: {
      recommendations: recommendationsReducer,
      shifts: (s = { shifts: [], selectedSiteId: "site-1", workers: [] } as unknown) => s,
      auth: (s = { user: SUPERVISOR } as unknown) => s,
    },
    preloadedState: { recommendations: state },
  });
}

function renderScreen(store: ReturnType<typeof buildStore>) {
  return render(
    <Provider store={store}>
      <RecommendationsScreen />
    </Provider>,
  );
}

beforeEach(() => jest.clearAllMocks());

/* ── Polling ───────────────────────────────────────────────────────────────────────────── */

it("registers a poll at the plans interval", async () => {
  await renderScreen(buildStore([recommendation("rec-1")]));

  expect(mockAutoRefresh).toHaveBeenCalled();
  // 60s: half the server's 2-minute auto-trigger cadence. Polling faster cannot surface
  // anything the scheduler has not drafted yet.
  expect(mockAutoRefresh.mock.calls[0][1]).toBe(60_000);
});

it("fetches on a poll tick, so an auto-drafted plan appears without user action", async () => {
  await renderScreen(buildStore([recommendation("rec-1")]));

  const before = mockFetchShifts.mock.calls.length;
  const calls = mockAutoRefresh.mock.calls;
  (calls[calls.length - 1][0] as () => void)();

  await waitFor(() => {
    expect(mockFetchShifts.mock.calls.length).toBeGreaterThan(before);
  });
});

it("NEVER asks the server to draft a plan", async () => {
  /*
   * The load-bearing restraint of this ticket. Auto-drafting is the SERVER's job: it holds the
   * dedup that makes a band change supersede the open plan rather than stack a second one, and
   * each draft is a real model call. A client that drafted on a timer would produce one plan
   * per watching supervisor per transition, all of them duplicates.
   */
  await renderScreen(buildStore([recommendation("rec-1")]));

  const calls = mockAutoRefresh.mock.calls;
  (calls[calls.length - 1][0] as () => void)();

  await waitFor(() => {
    expect(mockFetchShifts).toHaveBeenCalled();
  });
  expect(mockGenerate).not.toHaveBeenCalled();
});

it("does not poll while a decision is in flight", async () => {
  // A refresh reorders `items`, which is the FlatList's data — it can move a different plan
  // under a press aimed at Approve.
  await renderScreen(buildStore([recommendation("rec-1")], { decidingId: "rec-1" }));

  const before = mockFetchShifts.mock.calls.length;
  const calls = mockAutoRefresh.mock.calls;
  (calls[calls.length - 1][0] as () => void)();

  expect(mockFetchShifts.mock.calls.length).toBe(before);
});

it("does not poll while a pull-to-refresh is already running", async () => {
  /*
   * Driven through the real reducer rather than preloaded: the mount load dispatches its own
   * `loadRecommendations.pending` with `refreshing: false`, so a preloaded `refreshing: true`
   * would already be gone by the time the tick fires. Only `refreshing: true` in the action's
   * meta sets the flag -- see the slice.
   */
  const store = buildStore([recommendation("rec-1")]);
  await renderScreen(store);

  store.dispatch({
    type: "recommendations/load/pending",
    meta: { arg: { siteId: "site-1", refreshing: true } },
  });
  await waitFor(() => {
    expect(store.getState().recommendations.refreshing).toBe(true);
  });

  const before = mockFetchShifts.mock.calls.length;
  const calls = mockAutoRefresh.mock.calls;
  (calls[calls.length - 1][0] as () => void)();

  expect(mockFetchShifts.mock.calls.length).toBe(before);
});

/* ── Announcing arrivals ───────────────────────────────────────────────────────────────── */

it("says nothing about the plans already there when the tab is opened", async () => {
  // Without a seeded baseline, opening the tab would announce every existing plan as though
  // it had just arrived — which would train supervisors to ignore the notice.
  await renderScreen(buildStore([recommendation("rec-1"), recommendation("rec-2")]));

  await waitFor(() => {
    expect(mockAutoRefresh).toHaveBeenCalled();
  });
  expect(mockShowToast).not.toHaveBeenCalled();
});

it("announces a plan that arrives after the first load", async () => {
  const store = buildStore([recommendation("rec-1")]);
  await renderScreen(store);

  await waitFor(() => expect(mockAutoRefresh).toHaveBeenCalled());
  mockShowToast.mockClear();

  // What a poll finding an auto-drafted plan looks like to this screen.
  store.dispatch({
    type: "recommendations/load/fulfilled",
    payload: [recommendation("rec-1"), recommendation("rec-2")],
  });

  await waitFor(() => {
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ messageKey: "recommendations.autoDrafted" }),
    );
  });
});

it("uses the plural notice when several arrive at once", async () => {
  const store = buildStore([recommendation("rec-1")]);
  await renderScreen(store);

  await waitFor(() => expect(mockAutoRefresh).toHaveBeenCalled());
  mockShowToast.mockClear();

  store.dispatch({
    type: "recommendations/load/fulfilled",
    payload: [recommendation("rec-1"), recommendation("rec-2"), recommendation("rec-3")],
  });

  await waitFor(() => {
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ messageKey: "recommendations.autoDraftedMany" }),
    );
  });
});

it("stays quiet when a poll returns the same plans", async () => {
  const store = buildStore([recommendation("rec-1")]);
  await renderScreen(store);

  await waitFor(() => expect(mockAutoRefresh).toHaveBeenCalled());
  mockShowToast.mockClear();

  store.dispatch({
    type: "recommendations/load/fulfilled",
    payload: [recommendation("rec-1")],
  });

  expect(mockShowToast).not.toHaveBeenCalled();
});
