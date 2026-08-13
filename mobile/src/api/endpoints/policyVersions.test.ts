/**
 * api/endpoints/policyVersions (SCRUM-352 / FR-003, SCRUM-120).
 *
 * Reading is broader than writing (see the file's own header comment) — asserts the request
 * shape for list/create/activate, that a 409 (duplicate label, or activating a superseded
 * version) propagates rather than being swallowed, and that mock mode serves fixtures.
 */
const mockRequest = jest.fn();
const mockIsMockApi = jest.fn();

jest.mock("../client", () => ({ request: (...args: unknown[]) => mockRequest(...args) }));
jest.mock("@/auth/authMode", () => ({ isMockApi: () => mockIsMockApi() }));

import { activatePolicyVersion, createPolicyVersion, fetchPolicyVersions, type PolicyVersionInput } from "./policyVersions";
import { ApiError } from "../errors";

const INPUT: PolicyVersionInput = {
  versionLabel: "2026 rev 2",
  source: "MOM Work-Rest Guidelines 2026 rev 2",
  effectiveDate: "2026-09-01",
  wbgtThresholdUnacclimatisedLight: "29.0",
  wbgtThresholdUnacclimatisedModerate: "28.0",
  wbgtThresholdUnacclimatisedHeavy: "27.0",
  wbgtThresholdPartialLight: "30.0",
  wbgtThresholdPartialModerate: "29.0",
  wbgtThresholdPartialHeavy: "28.0",
  wbgtThresholdFullLight: "31.0",
  wbgtThresholdFullModerate: "30.0",
  wbgtThresholdFullHeavy: "29.0",
  wbgtEmergencyStop: "33.0",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMockApi.mockReturnValue(false);
});

describe("fetchPolicyVersions", () => {
  it("requests the full history for a site", async () => {
    mockRequest.mockResolvedValue([]);

    await fetchPolicyVersions("site-1");

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/sites/site-1/policy-versions",
      method: "GET",
    });
  });
});

describe("createPolicyVersion", () => {
  it("posts the new version's thresholds", async () => {
    mockRequest.mockResolvedValue({ id: "pv1" });

    await createPolicyVersion("site-1", INPUT);

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/sites/site-1/policy-versions",
      method: "POST",
      data: INPUT,
    });
  });

  it("propagates a conflict on a duplicate label", async () => {
    mockRequest.mockRejectedValue(new ApiError("conflict", "HTTP 409", 409, "req-1"));

    await expect(createPolicyVersion("site-1", INPUT)).rejects.toMatchObject({ kind: "conflict" });
  });

  it("propagates a validation failure when thresholds are out of order", async () => {
    mockRequest.mockRejectedValue(
      new ApiError("bad-request", "HTTP 400", 400, "req-1", {
        wbgtThresholdUnacclimatisedLight: "must be >= moderate",
      }),
    );

    await expect(createPolicyVersion("site-1", INPUT)).rejects.toMatchObject({
      fieldErrors: { wbgtThresholdUnacclimatisedLight: "must be >= moderate" },
    });
  });
});

describe("activatePolicyVersion", () => {
  it("posts to the activate endpoint", async () => {
    mockRequest.mockResolvedValue({ id: "pv1", status: "ACTIVE" });

    await activatePolicyVersion("site-1", "pv1");

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/sites/site-1/policy-versions/pv1/activate",
      method: "POST",
    });
  });

  it("propagates a conflict when the version is already superseded", async () => {
    mockRequest.mockRejectedValue(new ApiError("conflict", "HTTP 409", 409, "req-1"));

    await expect(activatePolicyVersion("site-1", "pv1")).rejects.toMatchObject({ kind: "conflict" });
  });
});

describe("mock mode", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockIsMockApi.mockReturnValue(true);
  });
  afterEach(() => jest.useRealTimers());

  it("serves fixtures instead of calling the real client", async () => {
    const pending = fetchPolicyVersions("site-1");
    await jest.advanceTimersByTimeAsync(350);
    const result = await pending;

    expect(mockRequest).not.toHaveBeenCalled();
    expect(Array.isArray(result)).toBe(true);
  });
});
