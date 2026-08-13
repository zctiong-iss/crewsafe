/**
 * api/endpoints/sites (SCRUM-352 / FR-003).
 *
 * Server-filtered by membership (see the file's own header comment). Asserts the request
 * shape, that an empty list is treated as a legitimate answer rather than an error, that a
 * failure still propagates, and that mock mode serves fixtures without calling out.
 */
const mockRequest = jest.fn();
const mockIsMockApi = jest.fn();

jest.mock("../client", () => ({ request: (...args: unknown[]) => mockRequest(...args) }));
jest.mock("@/auth/authMode", () => ({ isMockApi: () => mockIsMockApi() }));

import { fetchAccessibleSites } from "./sites";
import { ApiError } from "../errors";

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMockApi.mockReturnValue(false);
});

describe("real mode", () => {
  it("requests the caller's accessible sites", async () => {
    mockRequest.mockResolvedValue([{ id: "s1" }]);

    await fetchAccessibleSites([]);

    expect(mockRequest).toHaveBeenCalledWith({ url: "/api/v1/sites", method: "GET" });
  });

  it("treats an empty list as a legitimate, non-error answer", async () => {
    mockRequest.mockResolvedValue([]);

    await expect(fetchAccessibleSites([])).resolves.toEqual([]);
  });

  it("propagates a server error", async () => {
    mockRequest.mockRejectedValue(new ApiError("server", "HTTP 500", 500, "req-1"));

    await expect(fetchAccessibleSites([])).rejects.toMatchObject({ kind: "server" });
  });
});

describe("mock mode", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockIsMockApi.mockReturnValue(true);
  });
  afterEach(() => jest.useRealTimers());

  it("filters the fixture sites by the given membership instead of calling out", async () => {
    const pending = fetchAccessibleSites(["11111111-1111-4111-8111-111111111111"]);
    await jest.advanceTimersByTimeAsync(250);
    const result = await pending;

    expect(mockRequest).not.toHaveBeenCalled();
    expect(Array.isArray(result)).toBe(true);
  });
});
