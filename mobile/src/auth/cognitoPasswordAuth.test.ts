/**
 * Where the sign-in request is actually sent.
 *
 * This is one string, and it decides who signs the token the backend will trust. A
 * regression here is not a broken build — it is a release bundle authenticating against
 * something other than AWS, which nothing else in the app would notice.
 *
 * @author Justin Chua
 */
const mockPost = jest.fn();
jest.mock("axios", () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => mockPost(...args), isAxiosError: () => false },
}));

const mockConfig = {
  cognito: { region: "ap-southeast-1", cliClientId: "cli-client", idpEndpointOverride: "" },
};
jest.mock("@/constants/config", () => ({
  get config() {
    return mockConfig;
  },
}));

import { signInWithPassword } from "./cognitoPasswordAuth";

/** The shape `InitiateAuth` returns on success. */
function authSuccess() {
  return {
    data: {
      AuthenticationResult: {
        AccessToken: "header.payload.signature",
        ExpiresIn: 3600,
        RefreshToken: "refresh",
        TokenType: "Bearer",
      },
    },
  };
}

/** The url `axios.post` was called with. */
function calledUrl(): string {
  return mockPost.mock.calls[0][0] as string;
}

beforeEach(() => {
  mockPost.mockReset();
  mockPost.mockResolvedValue(authSuccess());
  mockConfig.cognito.idpEndpointOverride = "";
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
});

it("targets AWS when no override is configured", async () => {
  await signInWithPassword("worker1", "pw");

  expect(calledUrl()).toBe("https://cognito-idp.ap-southeast-1.amazonaws.com/");
});

it("targets the override in development", async () => {
  mockConfig.cognito.idpEndpointOverride = "http://10.0.2.2:9229";

  await signInWithPassword("worker1", "pw");

  // cognito-local answers on the root path, so the trailing slash matters.
  expect(calledUrl()).toBe("http://10.0.2.2:9229/");
});

it("does not double the slash when the override already ends in one", async () => {
  mockConfig.cognito.idpEndpointOverride = "http://localhost:9229/";

  await signInWithPassword("worker1", "pw");

  // A doubled slash is a 404 that reads like a missing service rather than a typo.
  expect(calledUrl()).toBe("http://localhost:9229/");
});

describe("expiry", () => {
  it("uses the ExpiresIn the IdP sent", async () => {
    const before = Date.now();

    const session = await signInWithPassword("worker1", "pw");

    expect(session.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
  });

  it("falls back to an hour when the IdP omits ExpiresIn", async () => {
    // cognito-local does exactly this. Without the fallback, expiresAt is NaN, loadSession
    // discards the session as corrupt, and every request afterwards goes out with no
    // Authorization header — surfacing as "this account has not been set up".
    mockPost.mockResolvedValue({
      data: { AuthenticationResult: { AccessToken: "a.b.c", TokenType: "Bearer" } },
    });

    const session = await signInWithPassword("worker1", "pw");

    expect(Number.isFinite(session.expiresAt)).toBe(true);
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it("falls back when ExpiresIn is zero or negative", async () => {
    mockPost.mockResolvedValue({
      data: { AuthenticationResult: { AccessToken: "a.b.c", ExpiresIn: 0, TokenType: "Bearer" } },
    });

    // A token that expires the instant it arrives is indistinguishable from no token.
    const session = await signInWithPassword("worker1", "pw");

    expect(session.expiresAt).toBeGreaterThan(Date.now() + 60_000);
  });
});

it("ignores the override outside __DEV__", async () => {
  // The check is on __DEV__ rather than the auth mode on purpose: no configuration may
  // redirect a release bundle's authentication, whatever mode it thinks it is in.
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  mockConfig.cognito.idpEndpointOverride = "http://attacker.example/";

  await signInWithPassword("worker1", "pw");

  expect(calledUrl()).toBe("https://cognito-idp.ap-southeast-1.amazonaws.com/");
});
