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

  it("asks the live endpoint about a real site, not the fixture's", async () => {
    mockFetchAccessibleSites.mockResolvedValue([{ id: REAL_SITE, name: "Bishan" }]);
    mockFetchSiteWeather.mockResolvedValue({ observation: observation(REAL_SITE), band: "BELOW_31" });

    const payload = await run();

    // The fixture id would 403 — `siteAccess.canAccess` has never heard of it.
    expect(mockFetchSiteWeather).toHaveBeenCalledWith(REAL_SITE, "w1");
    expect(mockFetchSiteConditions).not.toHaveBeenCalled();
    expect(payload.conditions?.siteId).toBe(REAL_SITE);
  });

  it("carries no policy rather than a fixture one", async () => {
    mockFetchAccessibleSites.mockResolvedValue([{ id: REAL_SITE, name: "Bishan" }]);
    mockFetchSiteWeather.mockResolvedValue({ observation: observation(REAL_SITE), band: "BELOW_31" });

    const payload = await run();

    // A real reading beside an invented obligation would look authoritative and be wrong.
    expect(payload.policy).toBeNull();
  });

  it("asks for lightning about the real site too, not the fixture's", async () => {
    // Found on device, not here: the first version of SCRUM-261 passed shift.siteId to
    // fetchLightningRisk and got a 403, because every live endpoint is site-scoped behind
    // @siteAccess.canAccess and the fixture's site exists nowhere. The heat reading had
    // already been fixed for this in SCRUM-209; lightning had to be fixed the same way.
    mockFetchAccessibleSites.mockResolvedValue([{ id: REAL_SITE, name: "Bishan" }]);
    mockFetchSiteWeather.mockResolvedValue({ observation: observation(REAL_SITE), band: "BELOW_31" });

    await run();

    expect(mockFetchLightningRisk).toHaveBeenCalledWith(REAL_SITE);
    expect(mockFetchLightningRisk).not.toHaveBeenCalledWith(FIXTURE_SITE);
  });

  it("does not ask for lightning at all when the worker has no site", async () => {
    mockFetchAccessibleSites.mockResolvedValue([]);

    await run();

    // No site means no site-scoped call to make. Asking anyway would be a guaranteed 403.
    expect(mockFetchLightningRisk).not.toHaveBeenCalled();
  });

  it("treats no memberships as an empty card, not a failure", async () => {
    mockFetchAccessibleSites.mockResolvedValue([]);

    const payload = await run();

    expect(mockFetchSiteWeather).not.toHaveBeenCalled();
    expect(payload.conditions).toBeNull();
  });
});
