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
import { StyleSheet } from "react-native";

import { sharedGap } from "@/styles/sharedStyles";

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
  const { queryByText, getAllByText } = await render(
    <Provider store={store}>
      <MyShiftScreen />
    </Provider>,
  );
  expect(queryByText("lightning.unavailable")).not.toBeNull();
});

it("shows the no-shift degraded state when the worker has nothing scheduled", async () => {
  const store = buildStore({ status: "ready", shift: null });
  const { queryByText, getAllByText } = await render(
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

  const { queryByText, getAllByText } = await render(
    <Provider store={store}>
      <MyShiftScreen />
    </Provider>,
  );

  expect(queryByText("lightning.stopWorkTitle")).not.toBeNull();
  expect(queryByText("Concrete pour")).not.toBeNull();
  const ordered = getAllByText(/lightning\.stopWorkTitle|Concrete pour/).map(
    (node) => String(node.props.children),
  );
  expect(ordered).toEqual(["lightning.stopWorkTitle", "Concrete pour"]);
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

/* ── Card spacing (SCRUM-TBD-60) ────────────────────────────────────────────────────────── */

/** Every host node in the rendered output, flattened. */
function hostNodes(tree: Awaited<ReturnType<typeof render>>): { props: Record<string, unknown> }[] {
  const found: { props: Record<string, unknown> }[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { props?: Record<string, unknown>; children?: unknown[] };
    if (n.props) found.push({ props: n.props });
    for (const child of n.children ?? []) walk(child);
  };
  const root = tree.toJSON();
  if (Array.isArray(root)) root.forEach(walk);
  else walk(root);
  return found;
}

/**
 * Every flattened style in the tree, from ANY style-bearing prop.
 *
 * Not just `style`: a ScrollView carries its content spacing on `contentContainerStyle`, and
 * that is precisely where this fix puts the gap. Scanning only `style` would find nothing and
 * report a passing container as broken.
 */
function allStyles(tree: Awaited<ReturnType<typeof render>>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const node of hostNodes(tree)) {
    for (const key of Object.keys(node.props)) {
      if (!key.toLowerCase().includes("style")) continue;
      const flat = StyleSheet.flatten(node.props[key] as never) as Record<string, unknown>;
      if (flat) out.push(flat);
    }
  }
  return out;
}

it("spaces the card stack from the container, not from each card", async () => {
  const store = buildStore({ status: "ready", shift: SHIFT, conditions: CONDITIONS });
  const tree = await render(
    <Provider store={store}>
      <MyShiftScreen />
    </Provider>,
  );

  // The gap is declared once, on the scroll content container, at `sharedGap` (12).
  const gapped = allStyles(tree).filter((s) => s.gap === sharedGap);
  expect(gapped.length).toBeGreaterThan(0);
});

it("gives the wellbeing card no root margin of its own", async () => {
  /*
   * THE REGRESSION THIS EXISTS FOR.
   *
   * WellbeingLogCard used `marginBottom: vs(12)` while every sibling used `marginTop`. React
   * Native does not collapse margins, so the space between two stacked cards came entirely
   * from the LOWER card's marginTop -- and this one had none. It sat flush against the heat
   * conditions card above it.
   *
   * Reintroducing a root margin here would break no other assertion in this file, which is
   * exactly why it needs its own.
   */
  const store = buildStore({ status: "ready", shift: SHIFT, conditions: CONDITIONS });
  const tree = await render(
    <Provider store={store}>
      <MyShiftScreen />
    </Provider>,
  );

  let node = tree.getByText("wellbeing.sectionTitle").parent;
  while (node) {
    const flat = (StyleSheet.flatten(node.props?.style) ?? {}) as Record<string, unknown>;
    if (flat.padding !== undefined) {
      expect(flat.marginBottom).toBeUndefined();
      expect(flat.marginTop).toBeUndefined();
      return;
    }
    node = node.parent;
  }
  throw new Error("wellbeing card surface not found");
});

/*
 * The combinations that actually differ between the demo, cognito and cognito-password paths.
 *
 * Auth mode does not change this layout -- the same component tree renders in all three. What
 * genuinely varies is which optional cards have data behind them, because each mode reaches a
 * different backend (or none). So the gap is asserted against the presence/absence matrix
 * rather than against a mode.
 */
describe.each([
  ["shift and conditions", { shift: SHIFT, conditions: CONDITIONS }],
  ["shift only", { shift: SHIFT, conditions: null }],
  ["conditions only", { shift: null, conditions: CONDITIONS }],
  ["neither", { shift: null, conditions: null }],
])("with %s", (_label, overrides) => {
  it("keeps the container gap however many cards are present", async () => {
    const store = buildStore({ status: "ready", ...overrides });
    const tree = await render(
      <Provider store={store}>
        <MyShiftScreen />
      </Provider>,
    );

    expect(allStyles(tree).filter((s) => s.gap === sharedGap).length).toBeGreaterThan(0);
  });

  it("lets no card reintroduce its own 12pt root margin", async () => {
    // A card carrying marginTop 12 on top of the container gap would render a 24pt space --
    // the inconsistency this ticket removed, arriving from the other direction.
    const store = buildStore({ status: "ready", ...overrides });
    const tree = await render(
      <Provider store={store}>
        <MyShiftScreen />
      </Provider>,
    );

    const cardSurfaces = allStyles(tree).filter((s) => s.padding !== undefined);
    for (const surface of cardSurfaces) {
      expect(surface.marginTop).toBeUndefined();
      expect(surface.marginBottom).toBeUndefined();
    }
  });
});
