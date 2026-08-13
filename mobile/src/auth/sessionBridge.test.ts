/**
 * sessionBridge (SCRUM-352 / FR-002).
 *
 * The only place the API client and the auth slice meet (see the file's own header
 * comment). Asserts the token provider's positive/negative resolution and that a 401
 * dispatches sessionExpired rather than reaching into SecureStore directly.
 */
const mockSetTokenProvider = jest.fn();
const mockSetUnauthenticatedHandler = jest.fn();
jest.mock("@/api/client", () => ({
  setTokenProvider: (...args: unknown[]) => mockSetTokenProvider(...args),
  setUnauthenticatedHandler: (...args: unknown[]) => mockSetUnauthenticatedHandler(...args),
}));

const mockLoadSession = jest.fn();
const mockIsExpired = jest.fn();
jest.mock("@/api/tokenStore", () => ({
  loadSession: () => mockLoadSession(),
  isExpired: (session: unknown) => mockIsExpired(session),
}));

const mockSessionExpired = jest.fn(() => ({ type: "auth/sessionExpired/mock" }));
jest.mock("@/store/reducers/authSlice", () => ({
  sessionExpired: () => mockSessionExpired(),
}));

const mockDispatch = jest.fn();
jest.mock("@/store/store", () => ({
  store: { dispatch: (...args: unknown[]) => mockDispatch(...args) },
}));

import { installSessionBridge } from "./sessionBridge";

beforeEach(() => {
  jest.clearAllMocks();
});

it("resolves the access token from a valid, unexpired session", async () => {
  mockLoadSession.mockResolvedValue({ accessToken: "a.b.c", refreshToken: null, expiresAt: 1 });
  mockIsExpired.mockReturnValue(false);

  installSessionBridge();
  const provider = mockSetTokenProvider.mock.calls[0][0] as () => Promise<string | null>;

  await expect(provider()).resolves.toBe("a.b.c");
});

it("resolves null when there is no stored session", async () => {
  mockLoadSession.mockResolvedValue(null);

  installSessionBridge();
  const provider = mockSetTokenProvider.mock.calls[0][0] as () => Promise<string | null>;

  await expect(provider()).resolves.toBeNull();
});

it("resolves null rather than sending an expired token", async () => {
  mockLoadSession.mockResolvedValue({ accessToken: "a.b.c", refreshToken: null, expiresAt: 1 });
  mockIsExpired.mockReturnValue(true);

  installSessionBridge();
  const provider = mockSetTokenProvider.mock.calls[0][0] as () => Promise<string | null>;

  await expect(provider()).resolves.toBeNull();
});

it("dispatches sessionExpired when the server rejects the token", () => {
  installSessionBridge();
  const handler = mockSetUnauthenticatedHandler.mock.calls[0][0] as () => void;

  handler();

  expect(mockSessionExpired).toHaveBeenCalled();
  expect(mockDispatch).toHaveBeenCalledWith({ type: "auth/sessionExpired/mock" });
});
