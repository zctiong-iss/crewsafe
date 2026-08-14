/**
 * How the forecast slice distinguishes a model that is declining from one that is broken,
 * and what it holds per horizon (SCRUM-364 / US-06).
 *
 * The `unavailable` cases carry the weight. A 503 is the ordinary answer whenever the weather
 * behind the model is stale, simulated, or off the 15-minute cadence, so it is the state a
 * real site will show most often — and the one most likely to be mistaken for a bug and
 * "fixed" into an error banner by someone reading the code later.
 *
 * @author Justin Chua
 */
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

import reducer, { forecastSiteChanged, loadForecast } from "./forecastSlice";
import { ForecastUnavailableError } from "@/api/endpoints/forecast";
import { ApiError } from "@/api/errors";
import type { SiteForecast } from "@/types/domain";

const SITE = "site-1";

function forecast(horizonMinutes: 30 | 60, predictedValue = 32.8): SiteForecast {
  return {
    metric: "WBGT",
    predictedValue,
    horizonMinutes,
    modelVersion: "wbgt-lgbm-2026.02",
    confidenceIntervalLower: predictedValue - 0.3,
    confidenceIntervalUpper: predictedValue + 0.3,
    generatedAt: "2026-08-14T01:00:00Z",
  };
}

/** Runs the real thunk body against a store stub and returns the resulting action. */
async function run(horizonMinutes: 30 | 60) {
  const dispatch = jest.fn();
  return loadForecast({ siteId: SITE, horizonMinutes })(dispatch, () => ({}), undefined);
}

const atSite = () => reducer(undefined, forecastSiteChanged(SITE));

beforeEach(() => jest.clearAllMocks());

describe("declining is not failing", () => {
  it("maps a declined forecast to unavailable", async () => {
    mockFetchSiteForecast.mockRejectedValue(new ForecastUnavailableError("req-9"));

    const action = await run(30);
    const next = reducer(atSite(), action);

    expect(next.horizons[30].status).toBe("unavailable");
  });

  it("never sets an errorKey when the model declines", async () => {
    mockFetchSiteForecast.mockRejectedValue(new ForecastUnavailableError("req-9"));

    const next = reducer(atSite(), await run(30));

    // The whole point. An errorKey here is what a screen renders as a red banner over a
    // weather view that is working perfectly.
    expect(next.horizons[30].errorKey).toBeNull();
  });

  it("keeps the request id so a genuine outage is still traceable", async () => {
    mockFetchSiteForecast.mockRejectedValue(new ForecastUnavailableError("req-9"));

    const next = reducer(atSite(), await run(30));

    expect(next.horizons[30].requestId).toBe("req-9");
  });

  it("maps a real server failure to error, with a key", async () => {
    mockFetchSiteForecast.mockRejectedValue(new ApiError("server", "HTTP 500", 500, "req-1"));

    const next = reducer(atSite(), await run(30));

    expect(next.horizons[30].status).toBe("error");
    expect(next.horizons[30].errorKey).toBe("errors.server");
  });

  it("drops a stale prediction when the model stops standing behind it", async () => {
    mockFetchSiteForecast.mockResolvedValue(forecast(30));
    const ready = reducer(atSite(), await run(30));
    expect(ready.horizons[30].forecast).not.toBeNull();

    mockFetchSiteForecast.mockRejectedValue(new ForecastUnavailableError());
    const next = reducer(ready, await run(30));

    // Keeping the last good number because it is the last one we happen to hold would show a
    // prediction the model has since refused to make.
    expect(next.horizons[30].forecast).toBeNull();
  });
});

describe("the horizons are independent", () => {
  it("does not blank a good 30 when 60 declines", async () => {
    mockFetchSiteForecast.mockResolvedValue(forecast(30, 32.8));
    const ready = reducer(atSite(), await run(30));

    mockFetchSiteForecast.mockRejectedValue(new ForecastUnavailableError());
    const next = reducer(ready, await run(60));

    expect(next.horizons[60].status).toBe("unavailable");
    expect(next.horizons[30].status).toBe("ready");
    expect(next.horizons[30].forecast?.predictedValue).toBe(32.8);
  });

  it("does not blank a good 60 when 30 errors", async () => {
    mockFetchSiteForecast.mockResolvedValue(forecast(60, 33.3));
    const ready = reducer(atSite(), await run(60));

    mockFetchSiteForecast.mockRejectedValue(new ApiError("server", "HTTP 500", 500, null));
    const next = reducer(ready, await run(30));

    expect(next.horizons[30].status).toBe("error");
    expect(next.horizons[60].forecast?.predictedValue).toBe(33.3);
  });
});

describe("loading", () => {
  it("shows loading on a first load", () => {
    const next = reducer(atSite(), {
      type: loadForecast.pending.type,
      meta: { arg: { siteId: SITE, horizonMinutes: 30 } },
    });
    expect(next.horizons[30].status).toBe("loading");
  });

  it("leaves an already-answered horizon alone on a background poll", async () => {
    mockFetchSiteForecast.mockResolvedValue(forecast(30));
    const ready = reducer(atSite(), await run(30));

    const next = reducer(ready, {
      type: loadForecast.pending.type,
      meta: { arg: { siteId: SITE, horizonMinutes: 30 } },
    });

    // Otherwise a five-minute auto-refresh flickers a spinner over a number somebody is
    // mid-way through reading.
    expect(next.horizons[30].status).toBe("ready");
  });

  it("shows the refresh spinner, not loading, on a pull-to-refresh", async () => {
    mockFetchSiteForecast.mockResolvedValue(forecast(30));
    const ready = reducer(atSite(), await run(30));

    const next = reducer(ready, {
      type: loadForecast.pending.type,
      meta: { arg: { siteId: SITE, horizonMinutes: 30, refreshing: true } },
    });

    expect(next.refreshing).toBe(true);
  });
});

describe("site scoping", () => {
  it("discards forecasts held for a different site", async () => {
    mockFetchSiteForecast.mockResolvedValue(forecast(30));
    const ready = reducer(atSite(), await run(30));

    const next = reducer(ready, forecastSiteChanged("site-2"));

    // A prediction is unlabelled once it is in the store; keeping it would show one site's
    // number under another site's name.
    expect(next.horizons[30].forecast).toBeNull();
    expect(next.horizons[30].status).toBe("idle");
  });

  it("keeps what it has when told the site it already holds", async () => {
    mockFetchSiteForecast.mockResolvedValue(forecast(30));
    const ready = reducer(atSite(), await run(30));

    const next = reducer(ready, forecastSiteChanged(SITE));

    expect(next.horizons[30].status).toBe("ready");
  });

  it("drops a response that lands after the user moved to another site", async () => {
    mockFetchSiteForecast.mockResolvedValue(forecast(30));
    const action = await run(30);

    // Tapping site A then site B starts two loads with no ordering guarantee; the slower one
    // must not win.
    const moved = reducer(atSite(), forecastSiteChanged("site-2"));
    const next = reducer(moved, action);

    expect(next.horizons[30].forecast).toBeNull();
  });
});

describe("site-scoped state clears on sign-out", () => {
  it.each(["auth/signOut/fulfilled", "auth/sessionExpired/fulfilled"])(
    "resets to initial state on %s",
    async (actionType) => {
      mockFetchSiteForecast.mockResolvedValue(forecast(30));
      const populated = reducer(atSite(), await run(30));

      const next = reducer(populated, { type: actionType });

      expect(next.siteId).toBeNull();
      expect(next.horizons[30].forecast).toBeNull();
    },
  );
});
