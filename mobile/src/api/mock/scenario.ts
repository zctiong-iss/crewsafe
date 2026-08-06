/**
 * Which mocked situation the app is showing.
 *
 * SCRUM-172's acceptance is "the worker sees the stop-work warning prominently and it
 * clears on expiry" — three states and a time-based transition. None of that is reachable
 * from a fixture that returns one fixed value, and none of it is reachable at all until
 * SCRUM-170 exists. This switch is what makes the criteria demonstrable now.
 *
 * Dev-only, and held as a module variable for the same reason `authMode` is: the store
 * imports the slices, which import the endpoints, which import this. Reading Redux from
 * here would close the loop.
 *
 * @author Justin Chua
 */
export type LightningScenario = "clear" | "advisory" | "stop-work";

/**
 * Where the lightning banner's state comes from (SCRUM-261).
 *
 * `live` is the default outside `mock` auth mode, because live *is* the product's behaviour
 * now that SCRUM-170 ingests strikes and derives per-site risk. `simulated` exists so a
 * reviewer can still exercise all three states on a clear day, which no live feed will
 * oblige them with.
 *
 * It has no effect in `mock` auth mode: that mode never touches the network, so there is
 * nothing to switch to. `fetchLightningRisk` checks `isMockApi()` first for that reason.
 */
export type LightningSource = "live" | "simulated";

let activeSource: LightningSource = "live";

export function getLightningSource(): LightningSource {
  return activeSource;
}

export function setLightningSource(source: LightningSource): void {
  if (!__DEV__) return;
  activeSource = source;
}

let activeScenario: LightningScenario = "stop-work";

export function getLightningScenario(): LightningScenario {
  return activeScenario;
}

export function setLightningScenario(scenario: LightningScenario): void {
  if (!__DEV__) return;
  activeScenario = scenario;
}

/*
 * Data freshness is switchable for the same reason the lightning state is: FR-12 requires
 * the UI to distinguish live, delayed, stale and simulated, and §7.1 requires a warning on
 * stale data. Neither is reviewable if the mock only ever returns one value.
 *
 * Defaults to SIMULATED — the honest label for a fixture. Selecting LIVE here does not make
 * the data real; it shows what the screen will look like once a real endpoint answers.
 */
import type { WeatherQualityStatus } from "@/types/domain";

let activeFreshness: WeatherQualityStatus = "SIMULATED";

export function getFreshnessScenario(): WeatherQualityStatus {
  return activeFreshness;
}

export function setFreshnessScenario(status: WeatherQualityStatus): void {
  if (!__DEV__) return;
  activeFreshness = status;
}

/*
 * Weather scenarios drive the *metrics*, not the condition directly.
 *
 * The screen classifies a condition from rainfall, wind and humidity (`helpers/weather.ts`).
 * Setting the condition here would bypass that and make the dev switcher prove nothing —
 * the icon would be right because it was told what to be. Setting the numbers exercises the
 * real path, thresholds and match order included.
 */
export type WeatherScenario = "fair" | "partly-cloudy" | "cloudy" | "windy" | "rain" | "storm";

export interface WeatherMetrics {
  humidity: number;
  windSpeed: number;
  rainfall: number;
}

const WEATHER_METRICS: Record<WeatherScenario, WeatherMetrics> = {
  fair: { humidity: 72, windSpeed: 6.2, rainfall: 0 },
  "partly-cloudy": { humidity: 81, windSpeed: 9.4, rainfall: 0 },
  cloudy: { humidity: 91, windSpeed: 11.0, rainfall: 0 },
  windy: { humidity: 84, windSpeed: 31.5, rainfall: 0 },
  rain: { humidity: 94, windSpeed: 14.2, rainfall: 3.8 },
  storm: { humidity: 96, windSpeed: 28.0, rainfall: 16.4 },
};

let activeWeather: WeatherScenario = "fair";
let nightOverride = false;

export function getWeatherScenario(): WeatherScenario {
  return activeWeather;
}

export function setWeatherScenario(scenario: WeatherScenario): void {
  if (!__DEV__) return;
  activeWeather = scenario;
}

export function getWeatherMetrics(): WeatherMetrics {
  return WEATHER_METRICS[activeWeather];
}

export function getNightOverride(): boolean {
  return nightOverride;
}

export function setNightOverride(enabled: boolean): void {
  if (!__DEV__) return;
  nightOverride = enabled;
}

/**
 * How long a mocked stop-work warning stays valid.
 *
 * Ninety seconds, not the ~30 minutes §7.1 describes for a real all-clear window. The real
 * figure makes the expiry transition untestable by hand — nobody watches a screen for half
 * an hour to confirm a banner clears. The duration is the only thing shortened; the
 * validity window is otherwise handled exactly as a real one would be.
 */
export const MOCK_STOP_WORK_WINDOW_MS = 90_000;

/** Advisory windows are longer: an advisory is a "keep watching", not a countdown. */
export const MOCK_ADVISORY_WINDOW_MS = 10 * 60_000;
