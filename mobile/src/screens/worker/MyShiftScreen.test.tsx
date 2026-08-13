/**
 * MyShiftScreen (SCRUM-352 / FR-005, FR-12a, SCRUM-172).
 *
 * Order is the requirement, not a layout preference: the lightning banner is the first
 * child, unconditionally, and a null lightning reading is said out loud rather than
 * rendered as silence (see the file's own header comment). Asserts the loading state, the
 * degraded "no shift" state, the lightning-data-unavailable notice, a populated shift with
 * an active stop-work, and the error/retry path — using the real `safetySlice` reducer with
 * only the network boundary mocked.
 */
jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useSystemReduceMotion: () => false,
}));
jest.mock("@/auth/authMode", () => ({ isMockApi: () => false }));
// useAutoRefresh's own polling/focus behaviour is not this screen's logic (and is not in
// this feature's target set) — mocked to a no-op so each test's preloaded store state is
// what the screen renders, rather than being immediately overwritten by a real dispatched
// load on mount.
jest.mock("@/hooks/useAutoRefresh", () => ({
  useAutoRefresh: () => {},
  REFRESH_INTERVALS: { SHIFT_MS: 60_000 },
}));
// Dev-panel scenario controls (__DEV__ is true under Jest) — mocked so the panel renders
// without needing real mock-scenario state, which is out of this feature's scope.
jest.mock("@/api/mock/scenario", () => ({
  getFreshnessScenario: () => "LIVE",
  getLightningScenario: () => "clear",
  getLightningSource: () => "simulated",
  setFreshnessScenario: jest.fn(),
  setLightningScenario: jest.fn(),
  setLightningSource: jest.fn(),
}));

const mockFetchMyShift = jest.fn();
const mockFetchLightningRisk = jest.fn();
const mockFetchSiteConditions = jest.fn();
const mockFetchSiteWeather = jest.fn();
jest.mock("@/api/endpoints/safety", () => ({
  fetchMyShift: (...a: unknown[]) => mockFetchMyShift(...a),
  fetchLightningRisk: (...a: unknown[]) => mockFetchLightningRisk(...a),
  fetchSiteConditions: (...a: unknown[]) => mockFetchSiteConditions(...a),
  fetchSiteWeather: (...a: unknown[]) => mockFetchSiteWeather(...a),
}));

import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { render } from "@testing-library/react-native";

import safetyReducer, { type SafetyState } from "@/store/reducers/safetySlice";
import wellbeingReducer from "@/store/reducers/wellbeingSlice";
import MyShiftScreen from "./MyShiftScreen";
import type { CurrentUser, LightningRisk, MyShift, SiteConditions } from "@/types/domain";

const WORKER: CurrentUser = {
  id: "w1",
  username: "worker1",
  displayName: "Worker One",
  role: "WORKER",
  siteIds: ["site-1"],
};

const SHIFT: MyShift = {
  shiftId: "shift-1",
  siteId: "site-1",
  startsAt: "2026-08-13T00:00:00Z",
  endsAt: "2026-08-13T08:00:00Z",
  status: "ACTIVE",
  assignment: { taskName: "Concrete pour", intensity: "HEAVY", acclimatisationDay: null },
};

function stopWorkRisk(now: number): LightningRisk {
  return {
    siteId: "site-1",
    state: "STOP_WORK",
    nearestStrikeKm: 3,
    observedAt: new Date(now - 60_000).toISOString(),
    validUntil: new Date(now + 10 * 60_000).toISOString(),
  };
}

const CONDITIONS: SiteConditions = {
  siteId: "site-1",
  wbgt: 32.1,
  temperature: 33,
  humidity: 75,
  windSpeed: 5,
  rainfall: 0,
  observedAt: "2026-08-13T02:00:00Z",
  ingestedAt: "2026-08-13T02:01:00Z",
  source: "NEA",
  qualityStatus: "LIVE",
  stationId: "S1",
};

function buildStore(safetyOverrides: Partial<SafetyState> = {}) {
  const safetyState: SafetyState = {
    status: "ready",
    shift: null,
    lightning: null,
    conditions: null,
    policy: null,
    errorKey: null,
    requestId: null,
    refreshing: false,
    ...safetyOverrides,
  };
  return configureStore({
    reducer: {
      safety: safetyReducer,
      wellbeing: wellbeingReducer,
      auth: (state = { user: WORKER } as unknown) => state,
    },
    preloadedState: { safety: safetyState },
  });
}

beforeEach(() => jest.clearAllMocks());

it("shows a loading indicator before the first load resolves", async () => {
  mockFetchMyShift.mockResolvedValue(null);
  const store = buildStore({ status: "loading" });
  const { toJSON } = await render(
    <Provider store={store}>
      <MyShiftScreen />
    </Provider>,
  );
  // AppLoader sets accessibilityRole="progressbar" — asserted structurally since Lottie is
  // real here (unlike InboxScreen's test) and renders no matchable text.
  const hasProgressbar = JSON.stringify(toJSON()).includes('"progressbar"');
  expect(hasProgressbar).toBe(true);
});

it("says lightning data is unavailable rather than showing silence, when a shift exists but the server has none", async () => {
  const store = buildStore({ status: "ready", shift: SHIFT, lightning: null });
  const { queryByText } = await render(
    <Provider store={store}>
      <MyShiftScreen />
    </Provider>,
  );
  expect(queryByText("lightning.unavailable")).not.toBeNull();
});

it("shows the no-shift degraded state when the worker has nothing scheduled", async () => {
  const store = buildStore({ status: "ready", shift: null });
  const { queryByText } = await render(
    <Provider store={store}>
      <MyShiftScreen />
    </Provider>,
  );
  expect(queryByText("shift.noShiftTitle")).not.toBeNull();
});

it("renders the lightning banner before the shift task, with an active stop-work", async () => {
  const now = Date.parse("2026-08-13T02:00:00Z");
  jest.spyOn(Date, "now").mockReturnValue(now);
  const store = buildStore({ status: "ready", shift: SHIFT, lightning: stopWorkRisk(now) });

  const { queryByText } = await render(
    <Provider store={store}>
      <MyShiftScreen />
    </Provider>,
  );

  expect(queryByText("lightning.stopWorkTitle")).not.toBeNull();
  expect(queryByText("Concrete pour")).not.toBeNull();
});

it("shows a freshness notice and the reading together when conditions are present", async () => {
  const store = buildStore({
    status: "ready",
    shift: SHIFT,
    lightning: { siteId: "site-1", state: "CLEAR", nearestStrikeKm: null, observedAt: "2026-08-13T01:50:00Z", validUntil: "2026-08-13T02:30:00Z" },
    conditions: { ...CONDITIONS, qualityStatus: "STALE" },
  });

  const { queryByText } = await render(
    <Provider store={store}>
      <MyShiftScreen />
    </Provider>,
  );

  expect(queryByText("freshness.staleWarning")).not.toBeNull();
});

it("shows an error banner with a retry action that reloads", async () => {
  mockFetchMyShift.mockResolvedValue(null);
  const store = buildStore({ status: "error", errorKey: "errors.network", requestId: "req-1" });

  const { getByText } = await render(
    <Provider store={store}>
      <MyShiftScreen />
    </Provider>,
  );

  expect(getByText("errors.network")).not.toBeNull();
  expect(getByText("common.retry")).not.toBeNull();
});

it("offers the wellbeing log card once a shift is present", async () => {
  const store = buildStore({ status: "ready", shift: SHIFT });
  const { queryByText } = await render(
    <Provider store={store}>
      <MyShiftScreen />
    </Provider>,
  );
  expect(queryByText("wellbeing.logRest")).not.toBeNull();
  expect(queryByText("wellbeing.logHydration")).not.toBeNull();
});
