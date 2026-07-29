import { describe, expect, it, vi } from "vitest";
import { apiFetch, setTokenProvider } from "./client";
import { ApiError } from "./errors";

/**
 * The HTTP client's contract with the rest of the app.
 *
 * The 401-vs-403 mapping is the load-bearing part: everything downstream decides whether to
 * end the session based on it, so getting it wrong logs people out for permission errors.
 */
describe("apiFetch", () => {
  const ok = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  it("attaches the bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({}));
    vi.stubGlobal("fetch", fetchMock);
    setTokenProvider(async () => "token-123");

    await apiFetch("/api/v1/me");

    const headers = fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer token-123");
  });

  it("sends no Authorization header when there is no session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({}));
    vi.stubGlobal("fetch", fetchMock);
    setTokenProvider(async () => null);

    await apiFetch("/api/v1/me");

    const headers = fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.has("Authorization")).toBe(false);
  });

  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not-found"],
    [400, "bad-request"],
    [500, "server"],
    [503, "server"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
    setTokenProvider(async () => "t");

    await expect(apiFetch("/api/v1/me")).rejects.toMatchObject({ kind });
  });

  /** 403 must never be reported as a session problem — that is what triggers a sign-out. */
  it("does not report a permission failure as unauthenticated", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 403 })));
    setTokenProvider(async () => "t");

    await expect(apiFetch("/api/v1/sites/other")).rejects.toMatchObject({
      kind: "forbidden",
    });
  });

  it("reports a failed connection as network, not a server error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    setTokenProvider(async () => "t");

    const error = await apiFetch("/api/v1/me").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("network");
  });

  it("keeps the request id from the response for support", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("{}", { status: 500, headers: { "X-Request-Id": "req-9" } }),
      ),
    );
    setTokenProvider(async () => "t");

    await expect(apiFetch("/api/v1/me")).rejects.toMatchObject({ requestId: "req-9" });
  });
});
