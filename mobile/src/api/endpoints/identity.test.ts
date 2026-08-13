/**
 * api/endpoints/identity (SCRUM-352 / FR-003).
 *
 * `GET /api/v1/me` — the database, not the token, is authority on role/site access (see the
 * file's own header comment). Asserts the real path opts out of session teardown on a 401
 * (a not-provisioned account, not a dead session), that an error still propagates, and that
 * mock mode resolves the fixture behind the sentinel token instead of calling the network.
 */
const mockRequest = jest.fn();
const mockIsMockApi = jest.fn();
const mockLoadSession = jest.fn();
const mockCurrentUserFromMockToken = jest.fn();

jest.mock("../client", () => ({ request: (...args: unknown[]) => mockRequest(...args) }));
jest.mock("@/auth/authMode", () => ({ isMockApi: () => mockIsMockApi() }));
jest.mock("../tokenStore", () => ({ loadSession: () => mockLoadSession() }));
jest.mock("@/auth/mockAuth", () => ({
  currentUserFromMockToken: (token: string) => mockCurrentUserFromMockToken(token),
}));

import { fetchCurrentUser } from "./identity";
import { ApiError } from "../errors";
import { AuthError } from "@/auth/AuthError";

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMockApi.mockReturnValue(false);
});

describe("real mode", () => {
  it("requests /api/v1/me with session teardown suppressed", async () => {
    mockRequest.mockResolvedValue({ id: "u1", username: "worker1", displayName: "Worker", role: "WORKER", siteIds: [] });

    await fetchCurrentUser();

    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/me",
      method: "GET",
      skipSessionTeardown: true,
    });
  });

  it("propagates a not-provisioned 401 rather than swallowing it", async () => {
    mockRequest.mockRejectedValue(new ApiError("unauthenticated", "HTTP 401", 401, "req-1"));

    await expect(fetchCurrentUser()).rejects.toMatchObject({ kind: "unauthenticated" });
  });
});

describe("mock mode", () => {
  beforeEach(() => mockIsMockApi.mockReturnValue(true));

  it("resolves the fixture behind the stored sentinel token", async () => {
    mockLoadSession.mockResolvedValue({ accessToken: "mock.user-1", refreshToken: null, expiresAt: 1 });
    mockCurrentUserFromMockToken.mockReturnValue({ id: "user-1" });

    const user = await fetchCurrentUser();

    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockCurrentUserFromMockToken).toHaveBeenCalledWith("mock.user-1");
    expect(user).toEqual({ id: "user-1" });
  });

  it("throws when mock mode has no stored session at all", async () => {
    mockLoadSession.mockResolvedValue(null);

    await expect(fetchCurrentUser()).rejects.toBeInstanceOf(AuthError);
  });
});
