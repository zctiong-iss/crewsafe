/** @author Zhong Cheng (with assistance from Claude) */
import { describe, expect, it } from "vitest";
import { ApiError, messageFor, type ApiErrorKind } from "./errors";

describe("ApiError", () => {
  it("retains kind, status, and requestId", () => {
    const error = new ApiError("forbidden", "raw server message", 403, "req-123");

    expect(error.name).toBe("ApiError");
    expect(error.kind).toBe("forbidden");
    expect(error.status).toBe(403);
    expect(error.requestId).toBe("req-123");
    expect(error.message).toBe("raw server message");
  });

  it("allows a null status and requestId for errors that never reached the server", () => {
    const error = new ApiError("network", "fetch failed", null, null);

    expect(error.status).toBeNull();
    expect(error.requestId).toBeNull();
  });
});

describe("messageFor", () => {
  const CASES: Array<[ApiErrorKind, string]> = [
    ["unauthenticated", "Your session has ended. Sign in to continue."],
    [
      "forbidden",
      "You do not have access to this. If you think you should, ask your site administrator.",
    ],
    [
      "not-provisioned",
      "Your sign-in worked, but this account has not been set up for CrewSafe yet. Ask your site administrator to add you.",
    ],
    ["not-found", "That page or record does not exist."],
    ["bad-request", "That request was not valid."],
    ["network", "Cannot reach CrewSafe. Check your connection and try again."],
    ["server", "Something went wrong on our end. Try again in a moment."],
  ];

  it.each(CASES)("maps %s to a user-facing message", (kind, expected) => {
    expect(messageFor(new ApiError(kind, "raw", null, null))).toBe(expected);
  });

  /**
   * The distinction the file's own doc comment calls out as the reason this taxonomy
   * exists: conflating 401 and 403 means a supervisor who opens another site's page gets
   * logged out and loses their work, instead of just being told no.
   */
  it("never conflates unauthenticated (401) with forbidden (403) messaging", () => {
    const unauthenticated = messageFor(new ApiError("unauthenticated", "raw", 401, null));
    const forbidden = messageFor(new ApiError("forbidden", "raw", 403, null));

    expect(unauthenticated).not.toBe(forbidden);
    expect(unauthenticated.toLowerCase()).toContain("session");
    expect(forbidden.toLowerCase()).not.toContain("session");
  });

  it("never surfaces the raw server message to the user", () => {
    const message = messageFor(new ApiError("server", "Stack trace leaked here", 500, null));
    expect(message).not.toContain("Stack trace leaked here");
  });
});
