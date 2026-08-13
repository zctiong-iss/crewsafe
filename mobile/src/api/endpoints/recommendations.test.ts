/**
 * api/endpoints/recommendations (SCRUM-352 / FR-003, FR-004, SCRUM-119).
 *
 * Two authorization shapes, deliberately different: oversight can read, but only the
 * supervisor who owns the crew can decide (see the file's own header comment). Asserts the
 * request shape for list/decide/generate, that a 409 on an already-decided recommendation
 * propagates rather than silently retrying, and that mock mode serves fixtures.
 */
const mockRequest = jest.fn();
const mockIsMockApi = jest.fn();

jest.mock("../client", () => ({ request: (...args: unknown[]) => mockRequest(...args) }));
jest.mock("@/auth/authMode", () => ({ isMockApi: () => mockIsMockApi() }));

import {
  decideRecommendation,
  fetchRecommendations,
  generateRecommendation,
  type DecisionInput,
} from "./recommendations";
import { ApiError } from "../errors";

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMockApi.mockReturnValue(false);
});

describe("fetchRecommendations", () => {
  it("requests the shift's recommendations", async () => {
    mockRequest.mockResolvedValue([]);

    await fetchRecommendations("site-1", "shift-1");

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/sites/site-1/shifts/shift-1/recommendations",
      method: "GET",
    });
  });
});

describe("decideRecommendation", () => {
  it("posts an approval decision", async () => {
    mockRequest.mockResolvedValue({ id: "rec-1", status: "APPROVED" });
    const input: DecisionInput = { decision: "APPROVED" };

    await decideRecommendation("site-1", "shift-1", "rec-1", input);

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/sites/site-1/shifts/shift-1/recommendations/rec-1/decision",
      method: "POST",
      data: input,
    });
  });

  it("posts a rejection with its required reason", async () => {
    mockRequest.mockResolvedValue({ id: "rec-1", status: "REJECTED" });
    const input: DecisionInput = { decision: "REJECTED", reason: "Site now under cover" };

    await decideRecommendation("site-1", "shift-1", "rec-1", input);

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({ data: { decision: "REJECTED", reason: "Site now under cover" } }),
    );
  });

  it("propagates a conflict when the recommendation was already decided", async () => {
    mockRequest.mockRejectedValue(new ApiError("conflict", "HTTP 409", 409, "req-1"));

    await expect(
      decideRecommendation("site-1", "shift-1", "rec-1", { decision: "APPROVED" }),
    ).rejects.toMatchObject({ kind: "conflict" });
  });

  it("propagates a forbidden error for an oversight-only caller", async () => {
    // GET is open to oversight roles; deciding is not — see the file's own header comment.
    mockRequest.mockRejectedValue(new ApiError("forbidden", "HTTP 403", 403, "req-1"));

    await expect(
      decideRecommendation("site-1", "shift-1", "rec-1", { decision: "APPROVED" }),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });
});

describe("generateRecommendation", () => {
  it("posts to the generate endpoint", async () => {
    mockRequest.mockResolvedValue({ id: "rec-2", status: "PENDING_APPROVAL" });

    await generateRecommendation("site-1", "shift-1");

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/sites/site-1/shifts/shift-1/recommendations/generate",
      method: "POST",
    });
  });
});

describe("mock mode", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockIsMockApi.mockReturnValue(true);
  });
  afterEach(() => jest.useRealTimers());

  it("serves fixtures instead of calling the real client", async () => {
    const pending = fetchRecommendations("site-1", "shift-1");
    await jest.advanceTimersByTimeAsync(350);
    const result = await pending;

    expect(mockRequest).not.toHaveBeenCalled();
    expect(Array.isArray(result)).toBe(true);
  });
});
