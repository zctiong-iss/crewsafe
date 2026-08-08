/**
 * Where the Heat conditions card's reading comes from, in each mode.
 *
 * The subtle one is the site id. Outside mock mode the shift's own site id is a fixture
 * UUID no deployment has, so using it would produce a 403 instead of a reading — and a 403
 * on this path blanks the heat card on the worker's main screen. That substitution is the
 * whole point of these tests, and it is invisible in review because both ids are UUIDs.
 *
 * @author Justin Chua
 */
const mockIsMockApi = jest.fn();
const mockFetchMyShift = jest.fn();
const mockFetchLightningRisk = jest.fn();
const mockFetchSiteConditions = jest.fn();
const mockFetchSiteWeather = jest.fn();
const mockFetchAccessibleSites = jest.fn();

jest.mock("@/auth/authMode", () => ({ isMockApi: () => mockIsMockApi() }));
jest.mock("@/api/endpoints/safety", () => ({
  fetchMyShift: () => mockFetchMyShift(),
  fetchLightningRisk: (...a: unknown[]) => mockFetchLightningRisk(...a),
  fetchSiteConditions: (...a: unknown[]) => mockFetchSiteConditions(...a),
  fetchSiteWeather: (...a: unknown[]) => mockFetchSiteWeather(...a),
}));
jest.mock("@/api/endpoints/sites", () => ({
  fetchAccessibleSites: (...a: unknown[]) => mockFetchAccessibleSites(...a),
}));

import { loadWorkerSafety } from "./safetySlice";

/** The fixture site id `mockMyShift` returns — not a site any backend has. */
const FIXTURE_SITE = "11111111-1111-4111-8111-111111111111";
/** What `DemoDataSeeder` actually creates: a generated id. */
const REAL_SITE = "103a5b5b-59de-45b3-9f0b-adfd64bb5aa8";

function shift() {
  return { siteId: FIXTURE_SITE, assignment: { intensity: "HEAVY" } };
}

function observation(siteId: string) {
  return { siteId, wbgt: 27.3, qualityStatus: "LIVE" };
}

/** Runs the thunk against a store stub and returns the fulfilled payload. */
async function run() {
  const dispatch = jest.fn();
  const action = await loadWorkerSafety({ workerId: "w1" })(dispatch, () => ({}), undefined);
  return action.payload as {
    conditions: { siteId: string } | null;
    policy: unknown;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchMyShift.mockResolvedValue(shift());
  mockFetchLightningRisk.mockResolvedValue({ state: "CLEAR" });
});

describe("mock mode", () => {
  beforeEach(() => mockIsMockApi.mockReturnValue(true));

  it("uses the shift's own site and keeps the mock policy", async () => {
    mockFetchSiteConditions.mockResolvedValue({
      observation: observation(FIXTURE_SITE),
      policy: { currentBand: "32_TO_BELOW_33" },
    });

    const payload = await run();

    expect(mockFetchSiteConditions).toHaveBeenCalledWith(FIXTURE_SITE, "HEAVY", "w1");
    expect(mockFetchAccessibleSites).not.toHaveBeenCalled();
    expect(payload.conditions?.siteId).toBe(FIXTURE_SITE);
    expect(payload.policy).not.toBeNull();
  });
});

describe("live mode", () => {
  beforeEach(() => mockIsMockApi.mockReturnValue(false));

  it("asks about the site the worker's shift is on", async () => {
    mockFetchSiteWeather.mockResolvedValue({ observation: observation(REAL_SITE), band: "BELOW_31" });
    mockFetchMyShift.mockResolvedValue({ ...shift(), siteId: REAL_SITE });

    const payload = await run();

    // Before SCRUM-266 this had to resolve the site from GET /api/v1/sites, because the shift
    // was a fixture naming a site no deployment had. /shifts/me is real now, so the shift names
    // the site the worker is actually standing on — a fact rather than a good guess.
    expect(mockFetchSiteWeather).toHaveBeenCalledWith(REAL_SITE, "w1");
    expect(mockFetchLightningRisk).toHaveBeenCalledWith(REAL_SITE);
    expect(mockFetchAccessibleSites).not.toHaveBeenCalled();
    expect(payload.conditions?.siteId).toBe(REAL_SITE);
  });

  it("carries no policy rather than a fixture one", async () => {
    mockFetchSiteWeather.mockResolvedValue({ observation: observation(REAL_SITE), band: "BELOW_31" });
    mockFetchMyShift.mockResolvedValue({ ...shift(), siteId: REAL_SITE });

    const payload = await run();

    // A real reading beside an invented obligation would look authoritative and be wrong.
    expect(payload.policy).toBeNull();
  });

  it("asks for nothing at all when the worker has no shift", async () => {
    mockFetchMyShift.mockResolvedValue(null);

    const payload = await run();

    // No shift means no site, and every live endpoint here is site-scoped. Asking anyway would
    // be a guaranteed 403.
    expect(mockFetchLightningRisk).not.toHaveBeenCalled();
    expect(mockFetchSiteWeather).not.toHaveBeenCalled();
    expect(payload.conditions).toBeNull();
  });
});
