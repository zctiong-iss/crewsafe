/**
 * api/endpoints/dispatch (SCRUM-352 / FR-003, FR-004).
 *
 * Real endpoints (SCRUM-186) — asserts the request shape for fetch/acknowledge/complete,
 * that an API error propagates rather than being swallowed, and that mock mode serves its
 * own fixtures instead of calling out.
 */
const mockRequest = jest.fn();
const mockIsMockApi = jest.fn();

jest.mock("../client", () => ({ request: (...args: unknown[]) => mockRequest(...args) }));
jest.mock("@/auth/authMode", () => ({ isMockApi: () => mockIsMockApi() }));

import { acknowledgeDispatch, completeDispatch, fetchPendingDispatches } from "./dispatch";
import { ApiError } from "../errors";

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMockApi.mockReturnValue(false);
});

describe("fetchPendingDispatches", () => {
  it("requests the worker's own pending dispatches", async () => {
    mockRequest.mockResolvedValue([]);

    await fetchPendingDispatches("worker-1");

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/action-dispatch/worker/worker-1/pending",
      method: "GET",
    });
  });

  it("propagates an API error rather than swallowing it", async () => {
    mockRequest.mockRejectedValue(new ApiError("forbidden", "HTTP 403", 403, "req-1"));

    await expect(fetchPendingDispatches("worker-1")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("acknowledgeDispatch", () => {
  it("sends the idempotency key so an offline replay is safe", async () => {
    mockRequest.mockResolvedValue({ id: "d1", status: "ACKNOWLEDGED" });

    await acknowledgeDispatch("d1", "idem-key-1");

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/action-dispatch/d1/acknowledge",
      method: "POST",
      headers: { "Idempotency-Key": "idem-key-1" },
    });
  });

  it("propagates a conflict when the dispatch was already actioned", async () => {
    mockRequest.mockRejectedValue(new ApiError("conflict", "HTTP 409", 409, "req-1"));

    await expect(acknowledgeDispatch("d1", "idem-key-1")).rejects.toMatchObject({
      kind: "conflict",
    });
  });
});

describe("completeDispatch", () => {
  it("requests completion by id", async () => {
    mockRequest.mockResolvedValue({ id: "d1", status: "COMPLETED" });

    await completeDispatch("d1");

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/action-dispatch/d1/complete",
      method: "POST",
    });
  });
});

describe("mock mode", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("serves fixtures instead of calling the real client", async () => {
    mockIsMockApi.mockReturnValue(true);

    const pending = fetchPendingDispatches("aaaaaaaa-0000-4000-8000-000000000001");
    await jest.advanceTimersByTimeAsync(400);
    const result = await pending;

    expect(mockRequest).not.toHaveBeenCalled();
    expect(Array.isArray(result)).toBe(true);
  });
});
