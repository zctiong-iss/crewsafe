/**
 * The live weather call (SCRUM-209).
 *
 * This is the first endpoint on the safety path that talks to a real backend, so what is
 * asserted here is the boundary itself: which mode calls which source, what is stripped off
 * the wire shape before it becomes a domain object, and which failures are answers rather
 * than errors. A band that arrives wrong or a 404 treated as a network fault both end with a
 * worker reading something untrue about the heat they are standing in.
 */
import { ApiError } from "../errors";

// `mock`-prefixed by necessity, not by style: jest hoists `jest.mock` above every const,
// and only that prefix is exempt from its out-of-scope-variable guard.
const mockRequest = jest.fn();
const mockIsMockApi = jest.fn();

jest.mock("../client", () => ({ request: (...args: unknown[]) => mockRequest(...args) }));
jest.mock("@/auth/authMode", () => ({ isMockApi: () => mockIsMockApi() }));

import { fetchSiteWeather } from "./safety";

const SITE = "11111111-1111-4111-8111-111111111111";

/** Exactly what `LatestWeatherResponse` serialises to, `id` and all. */
function wire(overrides: Record<string, unknown> = {}) {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    siteId: SITE,
    wbgt: 31.4,
    temperature: 33.2,
    humidity: 78,
    windSpeed: 9.1,
    rainfall: 0,
    observedAt: "2026-08-05T02:00:00Z",
    ingestedAt: "2026-08-05T02:01:00Z",
    source: "NEA",
    qualityStatus: "FRESH",
    stationId: "S50",
    band: "31_TO_BELOW_32",
    ...overrides,
  };
}

beforeEach(() => {
  mockRequest.mockReset();
  mockIsMockApi.mockReset();
  mockIsMockApi.mockReturnValue(false);
});

describe("fetchSiteWeather, live", () => {
  it("calls the site-scoped weather endpoint", async () => {
    mockRequest.mockResolvedValue(wire());

    await fetchSiteWeather(SITE, "w1");

    expect(mockRequest).toHaveBeenCalledWith({
      url: `/api/v1/sites/${SITE}/weather/latest`,
      method: "GET",
    });
  });

  it("returns the band the server evaluated rather than deriving one", async () => {
    // The wbgt below is in a different band from the one the server sent. The client must
    // report the server's answer regardless: §12.2 forbids a client overriding a band, and
    // a client that "corrected" this would be doing exactly that.
    mockRequest.mockResolvedValue(wire({ wbgt: 40, band: "BELOW_31" }));

    await expect(fetchSiteWeather(SITE, "w1")).resolves.toMatchObject({ band: "BELOW_31" });
  });

  it("keeps the observation free of fields that are not part of it", async () => {
    mockRequest.mockResolvedValue(wire());

    const { observation } = await fetchSiteWeather(SITE, "w1");

    // `id` is the database row's, and `band` is a verdict about the reading, not part of
    // it. Either one leaking in would make `SiteConditions` quietly wider than its type.
    expect(observation).not.toHaveProperty("id");
    expect(observation).not.toHaveProperty("band");
    expect(observation?.wbgt).toBe(31.4);
    expect(observation?.qualityStatus).toBe("FRESH");
  });

  it("carries a null band through instead of substituting the coolest one", async () => {
    mockRequest.mockResolvedValue(wire({ wbgt: null, band: null }));

    const result = await fetchSiteWeather(SITE, "w1");

    expect(result.band).toBeNull();
    expect(result.observation).not.toBeNull();
  });

  it("treats a 404 as a site with nothing ingested yet", async () => {
    mockRequest.mockRejectedValue(new ApiError("not-found", "no observation", 404, "req-1"));

    await expect(fetchSiteWeather(SITE, "w1")).resolves.toEqual({
      observation: null,
      band: null,
    });
  });

  it("still rejects on anything that is not a 404", async () => {
    // A 403 means this user may not read this site. Swallowing it the way a 404 is
    // swallowed would render an empty weather screen instead of an access error.
    const forbidden = new ApiError("forbidden", "denied", 403, "req-2");
    mockRequest.mockRejectedValue(forbidden);

    await expect(fetchSiteWeather(SITE, "w1")).rejects.toBe(forbidden);
  });
});

describe("fetchSiteWeather, mock mode", () => {
  it("never reaches the network and still supplies a band", async () => {
    mockIsMockApi.mockReturnValue(true);

    const result = await fetchSiteWeather(SITE, "w1");

    expect(mockRequest).not.toHaveBeenCalled();
    expect(result.observation).not.toBeNull();
    expect(result.band).not.toBeNull();
  });
});
