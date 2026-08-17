/**
 * ForecastScreen (SCRUM-368 / US-06).
 *
 * Asserts the four things this screen exists to get right: a prediction always arrives with
 * its interval, a declined forecast is explained rather than alarmed about, a genuine failure
 * still raises a banner, and one horizon going quiet never takes the other with it.
 *
 * Uses a real store with the real `forecastSlice` reducer, mocking only the network boundary,
 * so the 503-to-`unavailable` mapping is exercised for real rather than hand-rolled — that
 * mapping is the whole design and a hand-rolled state would prove nothing about it.
 *
 * @author Justin Chua
 */
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { render, screen, waitFor } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
jest.mock("@react-navigation/native", () => ({
  useRoute: () => ({ params: { siteId: "site-1" } }),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
// The loading state renders AppLoader, whose AnimatedIcon reads the preferences slice. This
// store holds only `forecast` on purpose — the point is to exercise the real forecast
// reducer, not to assemble a whole app store around one screen.
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useSystemReduceMotion: () => false,
  useReduceMotionPreference: () => false,
}));
// Fires its callback once on mount; the interval and focus behaviour are the hook's own
// concern and are covered where the hook lives.
jest.mock("@/hooks/useAutoRefresh", () => ({
  useAutoRefresh: (fn: () => void) => {
    const { useEffect } = jest.requireActual<typeof import("react")>("react");
    // Empty deps on purpose: `fn` is a fresh closure each render, so depending on it would
    // re-fire the load every render and the test would never settle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => fn(), []);
  },
  REFRESH_INTERVALS: { WEATHER_MS: 300000 },
}));

const mockFetchSiteForecast = jest.fn();
jest.mock("@/api/endpoints/forecast", () => {
  class ForecastUnavailableError extends Error {
    readonly requestId: string | null;
    constructor(requestId: string | null = null) {
      super("Forecast temporarily unavailable");
      this.name = "ForecastUnavailableError";
      this.requestId = requestId;
    }
  }
  return {
    ForecastUnavailableError,
    isForecastUnavailable: (v: unknown) => v instanceof ForecastUnavailableError,
    fetchSiteForecast: (...a: unknown[]) => mockFetchSiteForecast(...a),
  };
});

import forecast from "@/store/reducers/forecastSlice";
import { ForecastUnavailableError } from "@/api/endpoints/forecast";
import { ApiError } from "@/api/errors";
import ForecastScreen from "./ForecastScreen";
import type { SiteForecast } from "@/types/domain";

/** `band` is optional so every pre-existing case keeps exercising the no-band rendering. */
function prediction(
  horizonMinutes: 30 | 60,
  predictedValue: number,
  band?: SiteForecast["band"],
): SiteForecast {
  return {
    metric: "WBGT",
    predictedValue,
    horizonMinutes,
    modelVersion: "wbgt-lgbm-2026.02",
    confidenceIntervalLower: predictedValue - 0.3,
    confidenceIntervalUpper: predictedValue + 0.3,
    generatedAt: "2026-08-14T01:00:00Z",
    band,
  };
}

async function renderScreen() {
  const store = configureStore({ reducer: { forecast } });
  const view = await render(
    <Provider store={store}>
      <ForecastScreen />
    </Provider>,
  );
  return view;
}

/** Answers per horizon, so the two can be given different fates in one render. */
function answerWith(handler: (horizon: 30 | 60) => Promise<SiteForecast>) {
  mockFetchSiteForecast.mockImplementation((_siteId: string, horizon: 30 | 60) =>
    handler(horizon),
  );
}

beforeEach(() => jest.clearAllMocks());

it("shows a prediction with its interval, never the estimate alone", async () => {
  answerWith((h) => Promise.resolve(prediction(h, h === 30 ? 32.8 : 33.3)));

  await renderScreen();

  await waitFor(() => expect(screen.getByText("32.8")).toBeTruthy());
  // The interval is the thing that keeps a forecast from reading as a measurement, so its
  // presence is asserted rather than assumed.
  expect(screen.getAllByText("forecast.rangeLabel").length).toBeGreaterThan(0);
  expect(screen.getAllByText("forecast.range").length).toBeGreaterThan(0);
});

it("shows both horizons", async () => {
  answerWith((h) => Promise.resolve(prediction(h, h === 30 ? 32.8 : 33.3)));

  await renderScreen();

  await waitFor(() => expect(screen.getByText("32.8")).toBeTruthy());
  expect(screen.getByText("33.3")).toBeTruthy();
});

it("carries the provenance of each prediction", async () => {
  answerWith((h) => Promise.resolve(prediction(h, 32.8)));

  await renderScreen();

  // Model version and generation time on screen, not in a log: a forecast made forty minutes
  // ago is worth less than one made four minutes ago, and only this says which it is.
  await waitFor(() => expect(screen.getAllByText("forecast.model").length).toBe(2));
  expect(screen.getAllByText("forecast.generatedAt").length).toBe(2);
});

it("explains a declined forecast instead of raising an error", async () => {
  answerWith(() => Promise.reject(new ForecastUnavailableError()));

  await renderScreen();

  await waitFor(() => expect(screen.getAllByText("forecast.unavailableTitle").length).toBe(2));
  expect(screen.getAllByText("forecast.unavailableBody").length).toBe(2);
  // The assertion that protects the design: declining must not surface as a failure.
  expect(screen.queryByText("errors.server")).toBeNull();
  expect(screen.queryByText("common.retry")).toBeNull();
});

it("still raises a banner when the boundary genuinely fails", async () => {
  answerWith(() => Promise.reject(new ApiError("server", "HTTP 500", 500, "req-1")));

  await renderScreen();

  // A 500 is an outage. Dressing it up as a quiet "not right now" would hide it indefinitely.
  await waitFor(() => expect(screen.getAllByText("errors.server").length).toBe(2));
  expect(screen.getAllByText("common.retry").length).toBe(2);
});

it("keeps a good 30 when 60 declines", async () => {
  answerWith((h) =>
    h === 30
      ? Promise.resolve(prediction(30, 32.8))
      : Promise.reject(new ForecastUnavailableError()),
  );

  await renderScreen();

  await waitFor(() => expect(screen.getByText("32.8")).toBeTruthy());
  // One refusal, one prediction — the supervisor's question is still answerable.
  expect(screen.getAllByText("forecast.unavailableTitle").length).toBe(1);
});

it("states the band in words, not by colour alone", async () => {
  answerWith((h) => Promise.resolve(prediction(h, 32.8, "32_TO_BELOW_33")));

  await renderScreen();

  /*
   * Colour alone fails WCAG 1.4.1, and outdoors it also fails to sunlight flattening hue and to
   * red/green colour-vision deficiency. The words are the actual signal; the colour is a
   * shortcut to them.
   */
  await waitFor(() => expect(screen.getAllByText("wbgt.band.32_TO_BELOW_33").length).toBe(2));
});

it("renders no band when the server classified none, rather than the coolest one", async () => {
  // An unknown reading shown green would turn "we do not know" into "it is safe".
  answerWith((h) => Promise.resolve(prediction(h, 32.8)));

  await renderScreen();

  await waitFor(() => expect(screen.getAllByText("forecast.rangeLabel").length).toBe(2));
  expect(screen.queryByText(/wbgt\.band\./)).toBeNull();
});
