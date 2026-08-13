/**
 * signIn (SCRUM-352 / FR-002).
 *
 * The one entry point for signing in — picks a mode, produces a session, stores it (see the
 * file's own header comment). Asserts each mode's happy path, its missing-parameter
 * negative case, and that the dev-only mode gate is always checked first.
 */
const mockAssertModeAllowed = jest.fn();
const mockGetAuthMode = jest.fn();
jest.mock("./authMode", () => ({
  assertModeAllowed: (...args: unknown[]) => mockAssertModeAllowed(...args),
  getAuthMode: () => mockGetAuthMode(),
}));

const mockMockSessionFor = jest.fn();
jest.mock("./mockAuth", () => ({ mockSessionFor: (...args: unknown[]) => mockMockSessionFor(...args) }));

const mockSignInWithPassword = jest.fn();
jest.mock("./cognitoPasswordAuth", () => ({
  signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
}));

const mockSignInWithPkce = jest.fn();
jest.mock("./cognitoPkceAuth", () => ({ signInWithPkce: () => mockSignInWithPkce() }));

const mockSaveSession = jest.fn();
jest.mock("@/api/tokenStore", () => ({ saveSession: (...args: unknown[]) => mockSaveSession(...args) }));

import { performSignIn } from "./signIn";
import { AuthError } from "./AuthError";

const SESSION = { accessToken: "a", refreshToken: null, expiresAt: 1 };

beforeEach(() => {
  jest.clearAllMocks();
  mockSaveSession.mockResolvedValue(undefined);
});

it("checks the mode is allowed before doing anything else", async () => {
  mockGetAuthMode.mockReturnValue("cognito-pkce");
  mockSignInWithPkce.mockResolvedValue(SESSION);

  await performSignIn({});

  expect(mockAssertModeAllowed).toHaveBeenCalledWith("cognito-pkce");
});

it("signs in and stores the session for mock mode", async () => {
  mockGetAuthMode.mockReturnValue("mock");
  mockMockSessionFor.mockReturnValue(SESSION);

  await performSignIn({ demoUserId: "worker-1" });

  expect(mockMockSessionFor).toHaveBeenCalledWith("worker-1");
  expect(mockSaveSession).toHaveBeenCalledWith(SESSION);
});

it("rejects mock mode with no demo user selected", async () => {
  mockGetAuthMode.mockReturnValue("mock");

  await expect(performSignIn({})).rejects.toBeInstanceOf(AuthError);
  expect(mockSaveSession).not.toHaveBeenCalled();
});

it("signs in and stores the session for cognito-password mode", async () => {
  mockGetAuthMode.mockReturnValue("cognito-password");
  mockSignInWithPassword.mockResolvedValue(SESSION);

  await performSignIn({ username: "worker1", password: "pw" });

  expect(mockSignInWithPassword).toHaveBeenCalledWith("worker1", "pw");
  expect(mockSaveSession).toHaveBeenCalledWith(SESSION);
});

it("rejects cognito-password mode with a missing credential", async () => {
  mockGetAuthMode.mockReturnValue("cognito-password");

  await expect(performSignIn({ username: "worker1" })).rejects.toBeInstanceOf(AuthError);
  expect(mockSignInWithPassword).not.toHaveBeenCalled();
});

it("signs in and stores the session for cognito-pkce mode", async () => {
  mockGetAuthMode.mockReturnValue("cognito-pkce");
  mockSignInWithPkce.mockResolvedValue(SESSION);

  await performSignIn({});

  expect(mockSaveSession).toHaveBeenCalledWith(SESSION);
});

it("propagates a rejected credential exchange without storing a session", async () => {
  mockGetAuthMode.mockReturnValue("cognito-password");
  mockSignInWithPassword.mockRejectedValue(new AuthError("auth.cognito.invalidCredentials"));

  await expect(performSignIn({ username: "worker1", password: "wrong" })).rejects.toBeInstanceOf(
    AuthError,
  );
  expect(mockSaveSession).not.toHaveBeenCalled();
});
