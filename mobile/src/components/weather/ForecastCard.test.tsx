/**
 * ForecastCard (SCRUM-368 / US-06).
 *
 * The card's job on the weather screen is to be useful without being loud. These assert that
 * it degrades to a single line when the model declines, that a real failure does not raise a
 * second banner over a screen that may already be showing one, and that it opens the full
 * forecast either way — because the banner, the request id and the retry live there.
 *
 * @author Justin Chua
 */
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: (...a: unknown[]) => mockNavigate(...a) }),
}));
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
import ForecastCard from "./ForecastCard";

async function renderCard() {
  const store = configureStore({ reducer: { forecast } });
  return render(
    <Provider store={store}>
      <ForecastCard siteId="site-1" />
    </Provider>,
  );
}

beforeEach(() => jest.clearAllMocks());

it("previews the 30-minute prediction only", async () => {
  mockFetchSiteForecast.mockResolvedValue({
    metric: "WBGT",
    predictedValue: 32.8,
    horizonMinutes: 30,
    modelVersion: "wbgt-lgbm-2026.02",
    confidenceIntervalLower: 32.5,
    confidenceIntervalUpper: 33.1,
    generatedAt: "2026-08-14T01:00:00Z",
  });

  await renderCard();

  await waitFor(() => expect(screen.getByText("forecast.cardValue")).toBeTruthy());
  // One request, not two: the 60-minute horizon belongs to the screen this card opens.
  expect(mockFetchSiteForecast).toHaveBeenCalledTimes(1);
  expect(mockFetchSiteForecast).toHaveBeenCalledWith("site-1", 30);
});

it("collapses to one line when the model declines", async () => {
  mockFetchSiteForecast.mockRejectedValue(new ForecastUnavailableError());

  await renderCard();

  await waitFor(() => expect(screen.getByText("forecast.cardUnavailable")).toBeTruthy());
  // Nothing else on the weather screen changes, and no banner appears over it.
  expect(screen.queryByText("errors.server")).toBeNull();
});

it("stays to one line on a real failure rather than raising a second banner", async () => {
  mockFetchSiteForecast.mockRejectedValue(new ApiError("server", "HTTP 500", 500, "req-1"));

  await renderCard();

  await waitFor(() => expect(screen.getByText("forecast.cardError")).toBeTruthy());
  // The weather screen may already be showing its own banner; two stacked would say less
  // than one. The detail, request id and retry are on the forecast screen.
  expect(screen.queryByText("common.retry")).toBeNull();
});

it("opens the forecast screen for the site it was rendered for", async () => {
  mockFetchSiteForecast.mockRejectedValue(new ForecastUnavailableError());

  await renderCard();
  await waitFor(() => expect(screen.getByText("forecast.cardUnavailable")).toBeTruthy());
  fireEvent.press(screen.getByRole("button"));

  // Still reachable while unavailable — that screen is where the explanation lives.
  expect(mockNavigate).toHaveBeenCalledWith("Forecast", { siteId: "site-1" });
});
