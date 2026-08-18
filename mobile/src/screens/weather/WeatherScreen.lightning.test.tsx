/**
 * The lightning warning on the weather screen, for every role that has one.
 *
 * ── WHY THIS SCREEN NEEDED ITS OWN LIGHTNING ────────────────────────────────────────────
 * `safetySlice` already holds a lightning risk and it is the WORKER'S — loaded for the site
 * of the shift they are on. This screen's site comes from a picker and can be any of the
 * twenty a manager oversees, so reusing that value would have shown a manager looking at site
 * seven the lightning at site one. The reading and the risk are fetched together, for the
 * selected site, in `weatherSlice`.
 *
 * FR-12a puts the warning ABOVE the reading, which is asserted here rather than assumed:
 * order is the requirement, not an accident of where the JSX happened to be pasted.
 *
 * @author Justin Chua
 */
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

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
  useReduceMotion: () => true,
  useSystemReduceMotion: () => true,
  useReduceMotionPreference: () => true,
}));
jest.mock("@/hooks/useAutoRefresh", () => ({
  useAutoRefresh: jest.fn(),
  REFRESH_INTERVALS: { WEATHER_MS: 300_000 },
}));
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: jest.fn(),
  // The animated weather backdrop pauses itself off-screen; here it is always on.
  useIsFocused: () => true,
}));
jest.mock("@/api/endpoints/safety", () => ({
  fetchSiteWeather: jest.fn().mockResolvedValue({ observation: null, band: null }),
  fetchLightningRisk: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/api/endpoints/sites", () => ({ fetchAccessibleSites: jest.fn().mockResolvedValue([]) }));
jest.mock("@/api/endpoints/siteWeatherSummary", () => ({
  fetchSiteWeatherSummaries: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/components/weather/ForecastCard", () => () => null);

import weatherReducer, { type WeatherState } from "@/store/reducers/weatherSlice";
import WeatherScreen from "./WeatherScreen";
import type { CurrentUser, LightningRisk } from "@/types/domain";

const MANAGER: CurrentUser = {
  id: "sm-1",
  username: "manager1",
  displayName: "Manager One",
  role: "SAFETY_MANAGER",
  siteIds: ["site-1"],
};
const SUPERVISOR: CurrentUser = { ...MANAGER, id: "sup-1", role: "SUPERVISOR" };
const WORKER: CurrentUser = { ...MANAGER, id: "w-1", role: "WORKER" };

const STOP_WORK: LightningRisk = {
  siteId: "site-1",
  state: "STOP_WORK",
  nearestStrikeKm: 3,
  observedAt: "2026-08-18T13:50:00Z",
  validUntil: "2099-01-01T00:00:00Z",
};

const CONDITIONS = {
  siteId: "site-1",
  wbgt: 26.6,
  temperature: 29.6,
  humidity: 80,
  windSpeed: 5,
  rainfall: 0,
  observedAt: "2026-08-18T13:45:00Z",
  ingestedAt: "2026-08-18T13:46:00Z",
  source: "NEA",
  qualityStatus: "LIVE",
  stationId: "S128",
};

function buildStore(user: CurrentUser, lightning: LightningRisk | null) {
  const base = weatherReducer(undefined, { type: "@@INIT" }) as WeatherState;

  return configureStore({
    reducer: {
      weather: (state = { ...base } as unknown) => state,
      auth: (state = { user } as unknown) => state,
      forecast: (state = { byShift: {} } as unknown) => state,
    },
    preloadedState: {
      weather: {
        ...base,
        status: "ready",
        sites: [{ id: "site-1", name: "Bishan Park Landscaping" }],
        selectedSiteId: "site-1",
        conditions: CONDITIONS,
        band: "GREEN",
        lightning,
      },
    },
  });
}

/** Insets the site picker's bottom sheet reads; without a provider it throws on render. */
const INSET_FRAME = { x: 0, y: 0, width: 390, height: 844 };
const INSETS = { top: 0, left: 0, right: 0, bottom: 0 };

async function renderFor(user: CurrentUser, lightning: LightningRisk | null = STOP_WORK) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: INSET_FRAME, insets: INSETS }}>
      <Provider store={buildStore(user, lightning)}>
        <WeatherScreen />
      </Provider>
    </SafeAreaProvider>,
  );
}

/**
 * Every text node in render order.
 *
 * Children only — `JSON.stringify` on the tree hits a circular reference through the store
 * Provider's props, and the props are not what "above" means anyway.
 */
function textsInOrder(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(textsInOrder);
  if (node && typeof node === "object" && "children" in node) {
    return textsInOrder((node as { children?: unknown }).children ?? []);
  }
  return [];
}

it.each([
  ["a safety manager", MANAGER],
  ["a site supervisor", SUPERVISOR],
  ["a worker", WORKER],
])("shows the stop-work banner to %s", async (_name, user) => {
  /*
   * All three, and no role gate. WeatherScreen is one shared component, and a lightning
   * stop-work is the most severe thing this app says — a worker on the weather tab seeing a
   * temperature with no warning above it is the exact gap FR-12a exists to close.
   */
  const { queryByText } = await renderFor(user);

  expect(queryByText("lightning.stopWorkTitle")).not.toBeNull();
});

it("renders the warning ABOVE the reading, as FR-12a requires", async () => {
  /*
   * Order is the requirement. Asserted through the rendered tree rather than by reading the
   * JSX, because "above" survives a refactor only if something checks it.
   */
  const { toJSON } = await renderFor(MANAGER);

  const order = textsInOrder(toJSON());
  const bannerAt = order.indexOf("lightning.stopWorkTitle");
  const readingAt = order.findIndex((text) => text.includes("26.6"));

  expect(bannerAt).toBeGreaterThanOrEqual(0);
  expect(readingAt).toBeGreaterThanOrEqual(0);
  expect(readingAt).toBeGreaterThan(bannerAt);
});

it("says nothing when there is no lightning risk to report", async () => {
  // Silence is the correct output for a clear sky. A permanent "no lightning" banner on the
  // weather screen would train people past the space it occupies.
  const { queryByText } = await renderFor(MANAGER, null);

  expect(queryByText("lightning.stopWorkTitle")).toBeNull();
});

it("still shows the warning when the reading itself failed to load", async () => {
  /*
   * Rendered outside the conditions guard on purpose: a site whose WBGT request failed must
   * not also lose its stop-work notice, which is the more urgent of the two by far.
   */
  const { queryByText } = await renderFor(MANAGER);

  expect(queryByText("lightning.stopWorkTitle")).not.toBeNull();
});
