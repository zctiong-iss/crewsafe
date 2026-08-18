import React from "react";
import { Pressable, Text, View } from "react-native";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockReact = require("react");
const mockView = require("react-native").View;
const mockText = require("react-native").Text;
const mockPressable = require("react-native").Pressable;

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
jest.mock("@/hooks/useAutoRefresh", () => ({
  useAutoRefresh: () => {},
  REFRESH_INTERVALS: { WEATHER_MS: 300000 },
}));
jest.mock("@/auth/authMode", () => ({ isMockApi: () => false }));
jest.mock("@/components/views/AppSafeView", () => ({ children }: { children: React.ReactNode }) => mockReact.createElement(mockView, null, children));
jest.mock("@/components/texts/AppText", () => ({ children }: { children: React.ReactNode }) => mockReact.createElement(mockText, null, children));
jest.mock("@/components/buttons/AppButton", () => ({ title, onPress }: { title: string; onPress?: () => void }) => mockReact.createElement(mockPressable, { onPress }, mockReact.createElement(mockText, null, title)));
jest.mock("@/components/feedback/AppLoader", () => ({ message }: { message: string }) => mockReact.createElement(mockText, null, message));
jest.mock("@/components/feedback/MessageBanner", () => ({ message }: { message: string }) => mockReact.createElement(mockText, null, message));
jest.mock("@/components/weather/WeatherIcon", () => () => mockReact.createElement(mockText, null, "weather-icon"));
jest.mock("@/components/weather/backdrops/WeatherBackdrop", () => () => mockReact.createElement(mockView));
jest.mock("@/components/weather/ForecastCard", () => () => mockReact.createElement(mockText, null, "forecast-card"));
jest.mock("@/components/safety/FreshnessNotice", () => {
  const Notice = ({ status }: { status: string }) => mockReact.createElement(mockText, null, status);
  return { __esModule: true, default: Notice, showsStandingBanner: () => false };
});
jest.mock("@/components/weather/WeatherStatusRow", () => () => mockReact.createElement(mockText, null, "weather-status"));
jest.mock("@/components/weather/WeatherStatusModal", () => () => null);
jest.mock("@/components/inputs/AppSwitch", () => () => null);
jest.mock("@/components/inputs/RadioWithTitle", () => () => null);
jest.mock("@/components/weather/SiteConditionsPicker", () => ({ visible, onSelect }: { visible: boolean; onSelect: (id: string) => void }) =>
  visible ? mockReact.createElement(mockPressable, { onPress: () => onSelect("site-2") }, mockReact.createElement(mockText, null, "select-site-2")) : null,
);
jest.mock("@/api/mock/scenario", () => ({
  getNightOverride: () => false,
  getWeatherScenario: () => "fair",
  setNightOverride: jest.fn(),
  setWeatherScenario: jest.fn(),
}));
jest.mock("@/api/endpoints/sites", () => ({
  fetchAccessibleSites: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/api/endpoints/safety", () => ({
  fetchSiteWeather: jest.fn().mockResolvedValue({ observation: null, band: null }),
}));
jest.mock("@/api/endpoints/siteWeatherSummary", () => ({
  fetchSiteWeatherSummary: jest.fn().mockResolvedValue([]),
}));

import weatherReducer, { type WeatherState } from "@/store/reducers/weatherSlice";
import authReducer from "@/store/reducers/authSlice";
import WeatherScreen from "./WeatherScreen";
import type { Site, SiteConditions } from "@/types/domain";

const sites: Site[] = [
  { id: "site-1", name: "Alpha", latitude: "1", longitude: "103", timezone: "Asia/Singapore" },
  { id: "site-2", name: "Bravo", latitude: "1", longitude: "103", timezone: "Asia/Singapore" },
];
const conditions: SiteConditions = {
  siteId: "site-1",
  wbgt: 31.5,
  temperature: 32,
  humidity: 70,
  windSpeed: 5,
  rainfall: 0,
  observedAt: "2026-08-18T01:00:00Z",
  ingestedAt: "2026-08-18T01:01:00Z",
  source: "NEA",
  qualityStatus: "LIVE",
  stationId: "station-1",
};

function state(overrides: Partial<WeatherState>): WeatherState {
  return {
    status: "ready",
    sites,
    selectedSiteId: "site-1",
    conditions,
    band: "31_TO_BELOW_32",
    summaryBySite: {},
    errorKey: null,
    requestId: null,
    refreshing: false,
    ...overrides,
  };
}

async function renderScreen(weather: WeatherState) {
  const store = configureStore({
    reducer: { weather: weatherReducer, auth: authReducer },
    preloadedState: {
      weather,
      auth: { user: { id: "worker-1", username: "worker", displayName: "Worker", role: "WORKER" as const, siteIds: ["site-1", "site-2"] }, status: "signed-in" as const, errorKey: null, errorParams: {}, requestId: null, signingIn: false, signingOut: false },
    },
  });
  const view = await render(<Provider store={store}><WeatherScreen /></Provider>);
  return Object.assign(view, { store });
}

describe("WeatherScreen state precedence and site selection", () => {
  it("renders loading before other states", async () => {
    const view = await renderScreen(state({ status: "loading", conditions: null }));
    expect(view.getByText("common.loading")).toBeTruthy();
    expect(view.queryByText("weather.noSitesTitle")).toBeNull();
  });

  it("renders the error retry state before empty or content states and retries", async () => {
    const view = await renderScreen(state({ status: "error", errorKey: "errors.network", conditions: null }));
    expect(view.getByText("errors.network")).toBeTruthy();
    expect(view.queryByText("weather.noSitesTitle")).toBeNull();
    fireEvent.press(view.getByText("common.retry"));
    await waitFor(() => expect(view.store.getState().weather.status).toBe("loading"));
  });

  it("renders no-sites and selected-site content states", async () => {
    const emptyView = await renderScreen(state({ sites: [], selectedSiteId: null, conditions: null }));
    expect(emptyView.getByText("weather.noSitesTitle")).toBeTruthy();

    const contentView = await renderScreen(state({ sites, selectedSiteId: "site-1", conditions }));
    expect(contentView.getByText("weather.condition.FAIR")).toBeTruthy();
    expect(contentView.getByText("forecast-card")).toBeTruthy();
  });

  it("preserves site selection and content ordering", async () => {
    const { store, getByRole, getByText, getAllByText } = await renderScreen(state({ sites, selectedSiteId: "site-1", conditions }));
    fireEvent.press(getByRole("button"));
    await waitFor(() => expect(getByText("select-site-2")).toBeTruthy());
    fireEvent.press(getByText("select-site-2"));
    expect(store.getState().weather.selectedSiteId).toBe("site-2");
    const labels = getAllByText(/weather\.|forecast-card/).map((node) => String(node.props.children));
    expect(labels.indexOf("weather.condition.FAIR")).toBeLessThan(labels.indexOf("forecast-card"));
    expect(labels.indexOf("weather.condition.FAIR")).toBeLessThan(labels.indexOf("weather.feelsLike"));
  });
});
