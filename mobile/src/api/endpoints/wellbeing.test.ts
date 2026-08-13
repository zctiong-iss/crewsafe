/**
 * api/endpoints/wellbeing (SCRUM-352 / FR-003, FR-005, US-11).
 *
 * Worker paths carry no worker id — the subject is always the token holder (see the file's
 * own header comment). Asserts the request shape for logging rest/hydration, raising and
 * acknowledging a concern, the supervisor-facing crew/site reads, a conflict on a
 * double-acknowledgement, and that mock mode serves fixtures.
 */
const mockRequest = jest.fn();
const mockIsMockApi = jest.fn();

jest.mock("../client", () => ({ request: (...args: unknown[]) => mockRequest(...args) }));
jest.mock("@/auth/authMode", () => ({ isMockApi: () => mockIsMockApi() }));

import {
  acknowledgeConcern,
  fetchCrewWellbeing,
  fetchSiteConcerns,
  logWellbeing,
  raiseConcern,
} from "./wellbeing";
import { ApiError } from "../errors";

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMockApi.mockReturnValue(false);
});

describe("logWellbeing", () => {
  it("posts the log type with no worker id in the URL", async () => {
    mockRequest.mockResolvedValue({ id: "log-1" });

    await logWellbeing("shift-1", "REST");

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/shifts/shift-1/wellbeing-logs",
      method: "POST",
      data: { logType: "REST" },
    });
  });
});

describe("raiseConcern", () => {
  it("posts the symptoms and optional note", async () => {
    mockRequest.mockResolvedValue({ id: "c1" });

    await raiseConcern("shift-1", { symptoms: ["DIZZINESS"], note: "Feeling faint" });

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/shifts/shift-1/concerns",
      method: "POST",
      data: { symptoms: ["DIZZINESS"], note: "Feeling faint" },
    });
  });

  it("propagates a validation failure", async () => {
    mockRequest.mockRejectedValue(new ApiError("bad-request", "HTTP 400", 400, "req-1"));

    await expect(raiseConcern("shift-1", { symptoms: [] })).rejects.toMatchObject({
      kind: "bad-request",
    });
  });
});

describe("supervisor reads", () => {
  it("requests the crew's wellbeing for a shift", async () => {
    mockRequest.mockResolvedValue([]);

    await fetchCrewWellbeing("site-1", "shift-1");

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/sites/site-1/shifts/shift-1/wellbeing",
      method: "GET",
    });
  });

  it("requests every concern across the site", async () => {
    mockRequest.mockResolvedValue([]);

    await fetchSiteConcerns("site-1");

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/sites/site-1/concerns",
      method: "GET",
    });
  });
});

describe("acknowledgeConcern", () => {
  it("posts the acknowledgement", async () => {
    mockRequest.mockResolvedValue({ id: "c1", status: "ACKNOWLEDGED" });

    await acknowledgeConcern("site-1", "c1");

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/sites/site-1/concerns/c1/acknowledge",
      method: "POST",
    });
  });

  it("propagates a conflict when someone else acknowledged first", async () => {
    mockRequest.mockRejectedValue(new ApiError("conflict", "HTTP 409", 409, "req-1"));

    await expect(acknowledgeConcern("site-1", "c1")).rejects.toMatchObject({ kind: "conflict" });
  });
});

describe("mock mode", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockIsMockApi.mockReturnValue(true);
  });
  afterEach(() => jest.useRealTimers());

  it("serves fixtures instead of calling the real client", async () => {
    const pending = fetchSiteConcerns("site-1");
    await jest.advanceTimersByTimeAsync(350);
    const result = await pending;

    expect(mockRequest).not.toHaveBeenCalled();
    expect(Array.isArray(result)).toBe(true);
  });
});
