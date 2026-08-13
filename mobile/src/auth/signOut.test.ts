/**
 * signOut (SCRUM-352 / FR-002).
 *
 * More than forgetting the local token — see the file's own header comment for the three
 * things that can outlive a naive sign-out. Asserts the local session always clears first,
 * that mock mode stops there, and that the refresh-token revoke and Hosted UI logout are
 * both best-effort per mode.
 */
const mockAxiosPost = jest.fn();
jest.mock("axios", () => ({ __esModule: true, default: { post: (...a: unknown[]) => mockAxiosPost(...a) } }));

const mockOpenAuthSessionAsync = jest.fn();
jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSessionAsync(...args),
}));

const mockClearSession = jest.fn();
const mockLoadSession = jest.fn();
jest.mock("@/api/tokenStore", () => ({
  clearSession: () => mockClearSession(),
  loadSession: () => mockLoadSession(),
}));

const mockConfig = {
  cognito: { cliClientId: "cli-client", hostedUiDomain: "https://auth.example.com" },
};
jest.mock("@/constants/config", () => ({
  get config() {
    return mockConfig;
  },
  pkceClientId: () => "pkce-client",
}));

const mockGetAuthMode = jest.fn();
jest.mock("./authMode", () => ({ getAuthMode: () => mockGetAuthMode() }));

import { performSignOut } from "./signOut";

beforeEach(() => {
  jest.clearAllMocks();
  mockClearSession.mockResolvedValue(undefined);
  mockLoadSession.mockResolvedValue(null);
  mockAxiosPost.mockResolvedValue({});
  mockOpenAuthSessionAsync.mockResolvedValue({ type: "success" });
  mockConfig.cognito.cliClientId = "cli-client";
  mockConfig.cognito.hostedUiDomain = "https://auth.example.com";
});

it("always clears the local session first", async () => {
  mockGetAuthMode.mockReturnValue("mock");

  await performSignOut();

  expect(mockClearSession).toHaveBeenCalled();
});

it("stops after the local clear for mock mode", async () => {
  mockGetAuthMode.mockReturnValue("mock");

  await performSignOut();

  expect(mockAxiosPost).not.toHaveBeenCalled();
  expect(mockOpenAuthSessionAsync).not.toHaveBeenCalled();
});

it("does not attempt a revoke when there is no refresh token", async () => {
  mockGetAuthMode.mockReturnValue("cognito-password");
  mockLoadSession.mockResolvedValue({ accessToken: "a", refreshToken: null, expiresAt: 1 });

  await performSignOut();

  expect(mockAxiosPost).not.toHaveBeenCalled();
});

it("revokes the refresh token for cognito-password mode", async () => {
  mockGetAuthMode.mockReturnValue("cognito-password");
  mockLoadSession.mockResolvedValue({ accessToken: "a", refreshToken: "refresh-1", expiresAt: 1 });

  await performSignOut();

  expect(mockAxiosPost).toHaveBeenCalledWith(
    expect.stringContaining("/oauth2/revoke"),
    expect.any(String),
    expect.any(Object),
  );
  // cognito-password never opened a browser session, so there is nothing to end here.
  expect(mockOpenAuthSessionAsync).not.toHaveBeenCalled();
});

it("does not throw when the revoke call fails offline", async () => {
  mockGetAuthMode.mockReturnValue("cognito-password");
  mockLoadSession.mockResolvedValue({ accessToken: "a", refreshToken: "refresh-1", expiresAt: 1 });
  mockAxiosPost.mockRejectedValue(new Error("network down"));

  await expect(performSignOut()).resolves.toBeUndefined();
});

it("ends the Hosted UI session for cognito-pkce mode", async () => {
  mockGetAuthMode.mockReturnValue("cognito-pkce");
  mockLoadSession.mockResolvedValue({ accessToken: "a", refreshToken: "refresh-1", expiresAt: 1 });

  await performSignOut();

  expect(mockOpenAuthSessionAsync).toHaveBeenCalled();
});

it("does not throw when the browser is dismissed", async () => {
  mockGetAuthMode.mockReturnValue("cognito-pkce");
  mockLoadSession.mockResolvedValue({ accessToken: "a", refreshToken: "refresh-1", expiresAt: 1 });
  mockOpenAuthSessionAsync.mockRejectedValue(new Error("dismissed"));

  await expect(performSignOut()).resolves.toBeUndefined();
});

it("does nothing further when the client id or hosted UI domain is unconfigured", async () => {
  mockGetAuthMode.mockReturnValue("cognito-password");
  mockConfig.cognito.cliClientId = "";
  mockLoadSession.mockResolvedValue({ accessToken: "a", refreshToken: "refresh-1", expiresAt: 1 });

  await performSignOut();

  expect(mockAxiosPost).not.toHaveBeenCalled();
});
