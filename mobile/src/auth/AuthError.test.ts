/**
 * AuthError (SCRUM-352 / FR-002).
 *
 * A thin carrier for a translation key and its interpolation params — see the file's own
 * header comment for why it exists instead of a raw message string.
 */
import { AuthError, isAuthError } from "./AuthError";

it("carries the message key and default empty params", () => {
  const error = new AuthError("auth.cognito.invalidCredentials");

  expect(error.name).toBe("AuthError");
  expect(error.messageKey).toBe("auth.cognito.invalidCredentials");
  expect(error.messageParams).toEqual({});
  expect(error.message).toBe("auth.cognito.invalidCredentials");
});

it("carries interpolation params when given", () => {
  const error = new AuthError("errors.configMissing", { keys: "EXPO_PUBLIC_X" });

  expect(error.messageParams).toEqual({ keys: "EXPO_PUBLIC_X" });
});

it("is an instance of Error", () => {
  expect(new AuthError("errors.unknown")).toBeInstanceOf(Error);
});

describe("isAuthError", () => {
  it("recognises an AuthError", () => {
    expect(isAuthError(new AuthError("errors.unknown"))).toBe(true);
  });

  it("rejects a plain Error", () => {
    expect(isAuthError(new Error("boom"))).toBe(false);
  });

  it("rejects a non-error value", () => {
    expect(isAuthError({ messageKey: "errors.unknown" })).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });
});
