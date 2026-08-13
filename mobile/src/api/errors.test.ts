/**
 * api/errors (SCRUM-352 / FR-003).
 *
 * The error taxonomy the UI branches on — 401 vs 403 is the distinction that matters most
 * (see the file's own header comment). Asserts every status-to-kind mapping and that
 * `messageKeyFor`/`isApiError` are simple, total functions.
 */
import { ApiError, isApiError, kindForStatus, messageKeyFor } from "./errors";

describe("kindForStatus", () => {
  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not-found"],
    [409, "conflict"],
    [400, "bad-request"],
    [422, "bad-request"],
    [500, "server"],
    [503, "server"],
  ] as const)("maps %s to %s", (status, kind) => {
    expect(kindForStatus(status)).toBe(kind);
  });
});

describe("messageKeyFor", () => {
  it("prefixes the kind with errors.", () => {
    const error = new ApiError("unauthenticated", "HTTP 401", 401, "req-1");
    expect(messageKeyFor(error)).toBe("errors.unauthenticated");
  });
});

describe("isApiError", () => {
  it("recognises an ApiError", () => {
    expect(isApiError(new ApiError("server", "HTTP 500", 500, null))).toBe(true);
  });

  it("rejects a plain Error", () => {
    expect(isApiError(new Error("boom"))).toBe(false);
  });

  it("rejects a non-error value", () => {
    expect(isApiError(null)).toBe(false);
    expect(isApiError({ kind: "server" })).toBe(false);
  });
});

describe("ApiError", () => {
  it("defaults fieldErrors to an empty object", () => {
    const error = new ApiError("server", "HTTP 500", 500, "req-1");
    expect(error.fieldErrors).toEqual({});
  });

  it("carries per-field errors when given", () => {
    const error = new ApiError("bad-request", "HTTP 400", 400, "req-1", {
      versionLabel: "must be unique",
    });
    expect(error.fieldErrors).toEqual({ versionLabel: "must be unique" });
  });

  it("is an instance of Error with name ApiError", () => {
    const error = new ApiError("network", "offline", null, null);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ApiError");
  });
});
