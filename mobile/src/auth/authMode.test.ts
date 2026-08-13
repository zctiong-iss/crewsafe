/**
 * authMode (SCRUM-352 / FR-002).
 *
 * `mock` and `cognito-password` must never run in a release bundle — enforced, not just
 * documented (see the file's own header comment). Asserts the dev-only gate throws outside
 * `__DEV__`, is a no-op inside it, and that `isMockApi` tracks the active mode.
 */
jest.mock("@/constants/config", () => ({ config: { authMode: "cognito-password" } }));

import { assertModeAllowed, isDevOnlyMode, isMockApi, getAuthMode, setAuthMode } from "./authMode";
import { AuthError } from "./AuthError";

beforeEach(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  setAuthMode("cognito-password");
});

describe("isDevOnlyMode", () => {
  it("flags mock and cognito-password as dev-only", () => {
    expect(isDevOnlyMode("mock")).toBe(true);
    expect(isDevOnlyMode("cognito-password")).toBe(true);
  });

  it("does not flag cognito-pkce", () => {
    expect(isDevOnlyMode("cognito-pkce")).toBe(false);
  });
});

describe("assertModeAllowed", () => {
  it("allows a dev-only mode inside __DEV__", () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    expect(() => assertModeAllowed("mock")).not.toThrow();
  });

  it("throws for a dev-only mode outside __DEV__", () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    expect(() => assertModeAllowed("cognito-password")).toThrow(AuthError);
  });

  it("allows cognito-pkce outside __DEV__", () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    expect(() => assertModeAllowed("cognito-pkce")).not.toThrow();
  });
});

describe("setAuthMode / getAuthMode", () => {
  it("switches the active mode inside __DEV__", () => {
    setAuthMode("mock");
    expect(getAuthMode()).toBe("mock");
  });

  it("is a no-op outside __DEV__", () => {
    setAuthMode("mock");
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;

    setAuthMode("cognito-pkce");

    expect(getAuthMode()).toBe("mock");
  });
});

describe("isMockApi", () => {
  it("is true only in mock mode", () => {
    setAuthMode("mock");
    expect(isMockApi()).toBe(true);

    setAuthMode("cognito-password");
    expect(isMockApi()).toBe(false);
  });
});
