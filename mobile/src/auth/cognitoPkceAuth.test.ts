/**
 * cognitoPkceAuth (SCRUM-352 / FR-002).
 *
 * The production-shaped flow — Hosted UI, authorization code + PKCE (see the file's own
 * header comment). Asserts the missing-config guard, the Expo Go detection that heads off
 * Cognito's unhelpful `redirect_mismatch`, the cancelled/failed exchange paths, and the
 * success mapping including the ExpiresIn fallback.
 */
const mockPromptAsync = jest.fn();
const mockExchangeCodeAsync = jest.fn();
const mockMakeRedirectUri = jest.fn();

// Defined inline inside the factory (rather than as a standalone class jest.mock closes
// over) so the constructor exists regardless of how babel-plugin-jest-hoist reorders this
// file's jest.mock call relative to other top-level statements.
jest.mock("expo-auth-session", () => ({
  AuthRequest: function AuthRequest(this: { codeVerifier: string; promptAsync: jest.Mock }) {
    this.codeVerifier = "verifier-123";
    this.promptAsync = mockPromptAsync;
  },
  exchangeCodeAsync: (...args: unknown[]) => mockExchangeCodeAsync(...args),
  makeRedirectUri: (...args: unknown[]) => mockMakeRedirectUri(...args),
}));

const mockConfig = {
  cognito: { hostedUiDomain: "https://auth.example.com" },
};
jest.mock("@/constants/config", () => ({
  get config() {
    return mockConfig;
  },
  pkceClientId: () => "pkce-client",
}));

import { signInWithPkce } from "./cognitoPkceAuth";
import { AuthError } from "./AuthError";

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.cognito.hostedUiDomain = "https://auth.example.com";
  mockMakeRedirectUri.mockReturnValue("crewsafe://callback");
  mockPromptAsync.mockResolvedValue({ type: "success", params: { code: "auth-code" } });
  mockExchangeCodeAsync.mockResolvedValue({
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresIn: 3600,
  });
});

it("throws a config error when the Hosted UI domain is missing", async () => {
  mockConfig.cognito.hostedUiDomain = "";

  await expect(signInWithPkce()).rejects.toBeInstanceOf(AuthError);
  expect(mockPromptAsync).not.toHaveBeenCalled();
});

it("refuses to run inside Expo Go, before ever prompting", async () => {
  mockMakeRedirectUri.mockReturnValue("exp://192.168.1.5:8082");

  await expect(signInWithPkce()).rejects.toMatchObject({
    messageKey: "auth.cognito.pkceUnavailableInExpoGo",
  });
  expect(mockPromptAsync).not.toHaveBeenCalled();
});

it("throws a cancelled error when the user dismisses the prompt", async () => {
  mockPromptAsync.mockResolvedValue({ type: "cancel" });

  await expect(signInWithPkce()).rejects.toMatchObject({ messageKey: "auth.cognito.cancelled" });
});

it("throws a server error for any other non-success result", async () => {
  mockPromptAsync.mockResolvedValue({ type: "error" });

  await expect(signInWithPkce()).rejects.toMatchObject({ messageKey: "errors.server" });
});

it("throws a server error when the success result carries no code", async () => {
  mockPromptAsync.mockResolvedValue({ type: "success", params: {} });

  await expect(signInWithPkce()).rejects.toMatchObject({ messageKey: "errors.server" });
});

it("throws a network error when the code exchange fails", async () => {
  mockExchangeCodeAsync.mockRejectedValue(new Error("offline"));

  await expect(signInWithPkce()).rejects.toMatchObject({ messageKey: "errors.network" });
});

it("returns the session on a successful exchange", async () => {
  const before = Date.now();

  const session = await signInWithPkce();

  expect(session.accessToken).toBe("access-1");
  expect(session.refreshToken).toBe("refresh-1");
  expect(session.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
});

it("falls back to a one-hour expiry when the token response omits expiresIn", async () => {
  mockExchangeCodeAsync.mockResolvedValue({ accessToken: "access-1", refreshToken: null });

  const session = await signInWithPkce();

  expect(session.refreshToken).toBeNull();
  expect(session.expiresAt).toBeGreaterThan(Date.now() + 3500 * 1000);
});
