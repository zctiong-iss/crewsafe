/**
 * api/endpoints/forecast (SCRUM-363 / US-06).
 *
 * The assertion that carries the most weight here is the 503 one. `SiteForecastService`
 * declines on seven ordinary conditions, so "the model is not predicting right now" and
 * "something is broken" arrive on the same code path and must leave it as different things.
 * If that separation ever regresses, the symptom is a red error banner on a healthy weather
 * screen — and nobody files a bug against a banner.
 *
 * @author Justin Chua
 */
const mockRequest = jest.fn();
const mockIsMockApi = jest.fn();
const mockGetForecastScenario = jest.fn();

jest.mock("../client", () => ({ request: (...args: unknown[]) => mockRequest(...args) }));
jest.mock("@/auth/authMode", () => ({ isMockApi: () => mockIsMockApi() }));
jest.mock("../mock/scenario", () => ({
  getForecastScenario: () => mockGetForecastScenario(),
}));

import { fetchSiteForecast, isForecastUnavailable } from "./forecast";
import { ApiError } from "../errors";

const SITE = "site-1";

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMockApi.mockReturnValue(false);
  mockGetForecastScenario.mockReturnValue("normal");
});

describe("real mode", () => {
  it("asks for the given site and horizon", async () => {
    mockRequest.mockResolvedValue({ metric: "WBGT" });

    await fetchSiteForecast(SITE, 60);

    expect(mockRequest).toHaveBeenCalledWith({
      url: `/api/v1/sites/${SITE}/weather/forecast`,
      method: "GET",
      params: { horizonMinutes: 60 },
    });
  });

  it("turns a 503 into an unavailable signal rather than an error", async () => {
    mockRequest.mockRejectedValue(new ApiError("server", "HTTP 503", 503, "req-9"));

    const error = await fetchSiteForecast(SITE, 30).catch((e: unknown) => e);

    // The distinction the whole screen rests on: declining is not failing.
    expect(isForecastUnavailable(error)).toBe(true);
  });

  it("keeps the request id when it declines, so a real outage is still traceable", async () => {
    mockRequest.mockRejectedValue(new ApiError("server", "HTTP 503", 503, "req-9"));

    const error = await fetchSiteForecast(SITE, 30).catch((e: unknown) => e);

    expect((error as { requestId: string | null }).requestId).toBe("req-9");
  });

  it("leaves a 500 as a real error", async () => {
    mockRequest.mockRejectedValue(new ApiError("server", "HTTP 500", 500, "req-1"));

    const error = await fetchSiteForecast(SITE, 30).catch((e: unknown) => e);

    // Only 503 means "declining". A 500 is the ML boundary genuinely broken, and dressing it
    // up as a quiet "not right now" would hide an outage indefinitely.
    expect(isForecastUnavailable(error)).toBe(false);
    expect(error).toBeInstanceOf(ApiError);
  });

  it("leaves a 403 as a real error", async () => {
    mockRequest.mockRejectedValue(new ApiError("forbidden", "HTTP 403", 403, null));

    const error = await fetchSiteForecast(SITE, 30).catch((e: unknown) => e);

    // A site the user may not read is an access problem to explain, not a missing forecast.
    expect(isForecastUnavailable(error)).toBe(false);
  });
});

describe("mock mode", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockIsMockApi.mockReturnValue(true);
  });
  afterEach(() => jest.useRealTimers());

  async function settle<T>(pending: Promise<T>): Promise<T | unknown> {
    const caught = pending.catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(250);
    return caught;
  }

  it("serves a fixture without calling out", async () => {
    const forecast = (await settle(fetchSiteForecast(SITE, 30))) as {
      metric: string;
      horizonMinutes: number;
    };

    expect(mockRequest).not.toHaveBeenCalled();
    expect(forecast.metric).toBe("WBGT");
    expect(forecast.horizonMinutes).toBe(30);
  });

  it("brackets the prediction with its interval", async () => {
    const f = (await settle(fetchSiteForecast(SITE, 30))) as {
      predictedValue: number;
      confidenceIntervalLower: number;
      confidenceIntervalUpper: number;
    };

    expect(f.confidenceIntervalLower).toBeLessThan(f.predictedValue);
    expect(f.confidenceIntervalUpper).toBeGreaterThan(f.predictedValue);
  });

  it("is less certain at 60 minutes than at 30", async () => {
    const near = (await settle(fetchSiteForecast(SITE, 30))) as Record<string, number>;
    const far = (await settle(fetchSiteForecast(SITE, 60))) as Record<string, number>;

    const width = (f: Record<string, number>) =>
      f.confidenceIntervalUpper - f.confidenceIntervalLower;

    // Not decoration. An interval that stayed the same width further out would misstate the
    // one thing it exists to communicate.
    expect(width(far)).toBeGreaterThan(width(near));
  });

  it("declines, rather than erroring, on the unavailable scenario", async () => {
    mockGetForecastScenario.mockReturnValue("unavailable");

    const error = await settle(fetchSiteForecast(SITE, 30));

    expect(isForecastUnavailable(error)).toBe(true);
  });

  it("widens the interval on the wide scenario without moving the estimate", async () => {
    const normal = (await settle(fetchSiteForecast(SITE, 30))) as Record<string, number>;
    mockGetForecastScenario.mockReturnValue("wide");
    const wide = (await settle(fetchSiteForecast(SITE, 30))) as Record<string, number>;

    expect(wide.predictedValue).toBe(normal.predictedValue);
    expect(wide.confidenceIntervalUpper - wide.confidenceIntervalLower).toBeGreaterThan(
      normal.confidenceIntervalUpper - normal.confidenceIntervalLower,
    );
  });
});
