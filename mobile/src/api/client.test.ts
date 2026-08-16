/**
 * api/client (SCRUM-352 / FR-003).
 *
 * The one axios instance for the whole app — bearer-token attachment, typed error mapping,
 * and the 401-vs-403 distinction that decides whether a session tears down (see the file's
 * own header comment). The interceptors are captured directly off the mocked `axios.create`
 * return value, since every other test in this repo mocks `../client` wholesale and would
 * never exercise this file's own logic otherwise.
 *
 * All mock state lives inside the `jest.mock` factory itself (not in an outer `const`) and
 * is retrieved afterward via `jest.requireMock` — `import`-derived requires are hoisted by
 * Babel above ordinary top-level statements, so an outer `const` the factory closes over is
 * still `undefined` at the moment `./client`'s own top-level `axios.create()` call runs.
 *
 * @author Justin Chua
 */
jest.mock("axios", () => {
  const captured: {
    requestUse: ((req: { headers: { set: jest.Mock } }) => unknown) | null;
    responseRejected: ((error: unknown) => unknown) | null;
  } = { requestUse: null, responseRejected: null };
  const httpRequest = jest.fn();
  const isAxiosError = jest.fn();

  return {
    __esModule: true,
    __captured: captured,
    __httpRequest: httpRequest,
    __isAxiosError: isAxiosError,
    default: {
      create: () => ({
        interceptors: {
          request: { use: (fn: typeof captured.requestUse) => { captured.requestUse = fn; } },
          response: {
            use: (_onFulfilled: unknown, onRejected: typeof captured.responseRejected) => {
              captured.responseRejected = onRejected;
            },
          },
        },
        request: httpRequest,
      }),
      isAxiosError,
    },
  };
});
jest.mock("@/constants/config", () => ({ config: { apiBaseUrl: "https://api.example.com" } }));

import { request, setTokenProvider, setUnauthenticatedHandler } from "./client";

const axiosMock = jest.requireMock("axios") as {
  __captured: {
    requestUse: (req: { headers: { set: jest.Mock } }) => unknown;
    responseRejected: (error: unknown) => Promise<never>;
  };
  __httpRequest: jest.Mock;
  __isAxiosError: jest.Mock;
};

beforeEach(() => {
  axiosMock.__httpRequest.mockReset();
  axiosMock.__isAxiosError.mockReset();
  setTokenProvider(async () => null);
  setUnauthenticatedHandler(() => {});
});

describe("request interceptor — bearer token attachment", () => {
  it("attaches the Authorization header when a token is available", async () => {
    setTokenProvider(async () => "token-123");
    const req = { headers: { set: jest.fn() } };

    await axiosMock.__captured.requestUse(req);

    expect(req.headers.set).toHaveBeenCalledWith("Authorization", "Bearer token-123");
  });

  it("attaches no header when there is no session", async () => {
    setTokenProvider(async () => null);
    const req = { headers: { set: jest.fn() } };

    await axiosMock.__captured.requestUse(req);

    expect(req.headers.set).not.toHaveBeenCalled();
  });
});

describe("request() wrapper", () => {
  it("resolves to the response body", async () => {
    axiosMock.__httpRequest.mockResolvedValue({ data: { id: "s1" } });

    await expect(request({ url: "/api/v1/sites", method: "GET" })).resolves.toEqual({ id: "s1" });
  });
});

describe("response error mapping", () => {
  beforeEach(() => axiosMock.__isAxiosError.mockReturnValue(true));

  it("maps a network failure (no response) to a network ApiError", async () => {
    await expect(
      axiosMock.__captured.responseRejected({ message: "timeout of 15000ms exceeded" }),
    ).rejects.toMatchObject({ kind: "network", requestId: null });
  });

  it("maps a 401 to unauthenticated and carries the request id", async () => {
    await expect(
      axiosMock.__captured.responseRejected({
        response: { status: 401, headers: { "x-request-id": "req-1" }, data: {} },
      }),
    ).rejects.toMatchObject({ kind: "unauthenticated", status: 401, requestId: "req-1" });
  });

  it("maps a 403 to forbidden, distinct from unauthenticated", async () => {
    await expect(
      axiosMock.__captured.responseRejected({ response: { status: 403, headers: {}, data: {} } }),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("extracts per-field errors when the server names fields", async () => {
    await expect(
      axiosMock.__captured.responseRejected({
        response: {
          status: 400,
          headers: {},
          data: { fieldErrors: { versionLabel: "must be unique" } },
        },
      }),
    ).rejects.toMatchObject({ fieldErrors: { versionLabel: "must be unique" } });
  });

  it("carries a recognised error code off the response body", async () => {
    await expect(
      axiosMock.__captured.responseRejected({
        response: {
          status: 409,
          headers: {},
          data: { error: "Conflict", message: "…", code: "NO_ACTIVE_POLICY" },
        },
      }),
    ).rejects.toMatchObject({ kind: "conflict", code: "NO_ACTIVE_POLICY" });
  });

  /*
   * A code this build does not know must land as null rather than being passed through, so
   * `messageKeyFor` falls back to the status message instead of producing a translation key
   * that resolves to nothing. This is what lets the backend add codes without shipping mobile.
   */
  it("drops an unrecognised error code rather than passing it through", async () => {
    await expect(
      axiosMock.__captured.responseRejected({
        response: { status: 409, headers: {}, data: { code: "SOME_FUTURE_CODE" } },
      }),
    ).rejects.toMatchObject({ kind: "conflict", code: null });
  });

  it("leaves the code null when the body names none", async () => {
    await expect(
      axiosMock.__captured.responseRejected({
        response: { status: 409, headers: {}, data: { error: "Conflict" } },
      }),
    ).rejects.toMatchObject({ code: null });
  });

  it("wraps a non-axios error as a generic server failure", async () => {
    axiosMock.__isAxiosError.mockReturnValue(false);

    await expect(
      axiosMock.__captured.responseRejected(new Error("something else entirely")),
    ).rejects.toMatchObject({ kind: "server", status: null });
  });

  it("signs the session out on an ordinary 401", async () => {
    const handler = jest.fn();
    setUnauthenticatedHandler(handler);

    await axiosMock.__captured
      .responseRejected({ response: { status: 401, headers: {}, data: {} } })
      .catch(() => {});

    expect(handler).toHaveBeenCalled();
  });

  it("does not sign the session out on a 403", async () => {
    const handler = jest.fn();
    setUnauthenticatedHandler(handler);

    await axiosMock.__captured
      .responseRejected({ response: { status: 403, headers: {}, data: {} } })
      .catch(() => {});

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not sign out a 401 whose request opted out via skipSessionTeardown", async () => {
    // The one call that needs this: GET /api/v1/me during session resolution, where a 401
    // means "not provisioned", not "session dead" — see the file's own header comment.
    const handler = jest.fn();
    setUnauthenticatedHandler(handler);

    await axiosMock.__captured
      .responseRejected({
        config: { skipSessionTeardown: true },
        response: { status: 401, headers: {}, data: {} },
      })
      .catch(() => {});

    expect(handler).not.toHaveBeenCalled();
  });
});
