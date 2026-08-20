import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { subscribeToConcerns } from "./concernStream";

const { fetchEventSource } = vi.hoisted(() => ({ fetchEventSource: vi.fn() }));
vi.mock("@microsoft/fetch-event-source", () => ({ fetchEventSource }));
vi.mock("@/auth/authConfig", () => ({ apiBaseUrl: "https://api.example" }));
vi.mock("./client", () => ({ currentAccessToken: vi.fn(async () => "token") }));

describe("subscribeToConcerns", () => {
  beforeEach(() => fetchEventSource.mockReset().mockResolvedValue(undefined));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("authenticates the stream and replaces each complete snapshot", async () => {
    const statuses: string[] = [];
    const snapshots: unknown[] = [];
    const unsubscribe = subscribeToConcerns("site-1", {
      onStatus: (status) => statuses.push(status),
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });
    expect(fetchEventSource).toHaveBeenCalledWith(
      "https://api.example/api/v1/sites/site-1/concerns/stream",
      expect.any(Object),
    );
    const options = fetchEventSource.mock.calls[0]![1];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Response(null, { headers: init?.headers }),
    ));
    const response = new Response(null, { status: 200, headers: { "content-type": "text/event-stream" } });
    await options.onopen(response);
    options.onmessage({ event: "concerns", data: "[]" });
    expect(snapshots).toHaveLength(1);
    expect(statuses).toContain("live");
    const request = await options.fetch("https://api.example/stream", {});
    expect(request.headers.get("Authorization")).toBe("Bearer token");
    expect(options.signal.aborted).toBe(false);
    unsubscribe();
    expect(options.signal.aborted).toBe(true);
  });

  it("closes on authorization failure and bounds transient retry backoff", async () => {
    const statuses: string[] = [];
    subscribeToConcerns("site-1", { onStatus: (status) => statuses.push(status), onSnapshot: vi.fn() });
    const options = fetchEventSource.mock.calls[0]![1];
    await expect(options.onopen(new Response(null, { status: 403 }))).rejects.toThrow();
    expect(statuses).toContain("closed");
    const delays = Array.from({ length: 7 }, () => options.onerror(new Error("network")));
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    expect(statuses).toContain("degraded");
  });

  it("degrades without committing a malformed snapshot and reconnects after a clean close", () => {
    const statuses: string[] = [];
    const onSnapshot = vi.fn();
    subscribeToConcerns("site-1", {
      onStatus: (status) => statuses.push(status),
      onSnapshot,
    });
    const options = fetchEventSource.mock.calls[0]![1];

    options.onmessage({ event: "concerns", data: '[{"status":"ACKNOWLEDGED"}]' });
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe("degraded");

    let recycle: unknown;
    try {
      options.onclose();
    } catch (error) {
      recycle = error;
    }
    expect(options.onerror(recycle)).toBe(500);
    expect(statuses.at(-1)).toBe("connecting");
  });
});
