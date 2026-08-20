/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "@/auth/AuthProvider";
import { fakeUserManager } from "@/test/fakeUserManager";
import type { ConditionsStreamHandlers } from "@/api/conditionsStream";
import type { ConditionsHistory } from "@/api/conditionsHistory";
import { ConditionsPanel } from "./ConditionsPanel";
import { useAuth } from "@/auth/useAuth";

function WhenSignedIn({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  return state.status === "signed-in" ? <>{children}</> : null;
}

const wrap = (ui: React.ReactElement) =>
  render(
    <MemoryRouter>
      <AuthProvider userManager={fakeUserManager({})}>
        <WhenSignedIn>{ui}</WhenSignedIn>
      </AuthProvider>
    </MemoryRouter>,
  );

const liveSnapshot = (wbgt: number, observedAt: string) => ({
  siteId: "s1", asOf: "2026-08-06T07:40:12Z", activeShift: null, lightning: null,
  conditions: {
    wbgt, currentBand: null, forecastBand: null, forecastWbgt30m: null,
    temperature: 33, humidity: 70, windSpeed: 2, rainfall: 0,
    observedAt, source: "NEA" as const, freshness: "LIVE" as const,
  },
});

const pendingHistory = () => new Promise<ConditionsHistory>(() => undefined);

describe("ConditionsPanel — degraded on staleness", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the stop-work banner above WBGT and auto-clears when expired", async () => {
    let handlers!: ConditionsStreamHandlers;
    const fakeSubscribe = (_siteId: string, h: ConditionsStreamHandlers) => {
      handlers = h;
      return () => {};
    };

    wrap(<ConditionsPanel siteId="s1" subscribe={fakeSubscribe} loadHistory={pendingHistory} />);

    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      handlers.onStatus("live");
      handlers.onSnapshot({
        siteId: "s1", asOf: "2026-08-06T07:40:12Z", activeShift: null,
        conditions: {
          wbgt: 31, currentBand: null, forecastBand: null, forecastWbgt30m: null,
          temperature: 33, humidity: 70, windSpeed: 2, rainfall: 0,
          observedAt: "2026-08-06T07:40:00Z", source: "NEA", freshness: "LIVE",
        },
        lightning: {
          state: "STOP_WORK", nearestStrikeKm: 5,
          observedAt: "2026-08-06T07:40:00Z",
          validUntil: new Date(Date.now() + 60_000).toISOString(),
          freshness: "LIVE",
        },
      }, []);
    });

    // Banner should appear
    expect(screen.getByRole("alert")).toHaveTextContent(/Stop work/i);
    expect(screen.getByText(/5 km/)).toBeInTheDocument();

    // Banner should be BEFORE WBGT in the DOM
    const alert = screen.getByRole("alert");
    const wbgt = screen.getByText(/31 °C/);
    expect(alert.compareDocumentPosition(wbgt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Advance past validUntil — banner auto-clears
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(screen.queryByText(/Stop work/i)).toBeNull();
  });

  it("shows a live reading, degrades after 40s of silence, recovers on the next snapshot", async () => {
    let handlers!: ConditionsStreamHandlers;
    const fakeSubscribe = (_siteId: string, h: ConditionsStreamHandlers) => {
      handlers = h;
      return () => {};
    };

    wrap(<ConditionsPanel siteId="s1" subscribe={fakeSubscribe} loadHistory={pendingHistory} />);

    // Settle auth under fake timers (replaces findByText)
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      handlers.onStatus("live");
      handlers.onSnapshot(liveSnapshot(31, "2026-08-06T07:40:00Z"), []);
    });
    expect(screen.getByText(/31/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();

    act(() => { vi.advanceTimersByTime(41_000); });
    expect(screen.getByRole("alert")).toHaveTextContent(/Live feed interrupted/i);
    expect(screen.getByText(/31/)).toBeInTheDocument();

    act(() => {
      handlers.onSnapshot(liveSnapshot(30, "2026-08-06T07:55:00Z"), []);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an unverified sensor warning and clears it after an in-range reading", async () => {
    let handlers!: ConditionsStreamHandlers;
    const fakeSubscribe = (_siteId: string, h: ConditionsStreamHandlers) => {
      handlers = h;
      return () => {};
    };

    wrap(<ConditionsPanel siteId="s1" subscribe={fakeSubscribe} loadHistory={pendingHistory} />);
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      handlers.onStatus("live");
      handlers.onSnapshot(liveSnapshot(37.2, "2026-08-06T07:40:00Z"), [{
        metric: "wbgt",
        value: 37.2,
        minimum: 20,
        maximum: 36,
      }]);
    });
    expect(screen.queryByText(/Live feed interrupted/i)).toBeNull();
    expect(screen.getByText(/37\.2 °C/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/take necessary heat-safety action/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/verify against official NEA data/i);

    act(() => {
      handlers.onSnapshot(liveSnapshot(35, "2026-08-06T07:55:00Z"), []);
    });

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("ConditionsPanel — status region semantics (SCRUM-420 / S6819, S3358)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const fakeSubscribeNoOp = (_siteId: string, h: ConditionsStreamHandlers) => {
    void h;
    return () => {};
  };

  it("renders the connecting message as an <output> status region before any snapshot arrives", async () => {
    wrap(<ConditionsPanel siteId="s1" subscribe={fakeSubscribeNoOp} loadHistory={pendingHistory} />);

    await act(async () => { vi.advanceTimersByTime(100); });

    const status = screen.getByText("Connecting to live conditions...");
    expect(status.tagName).toBe("OUTPUT");
    expect(status).toHaveClass("conditions-panel__loading");
  });

  it.each([
    ["LIVE", "Live"],
    ["DELAYED", "Delayed"],
    ["SIMULATED", "Simulated"],
    ["STALE", "Stale"],
  ] as const)(
    "renders the %s freshness badge as an <output> status region with text %s",
    async (freshness, expectedText) => {
      let handlers!: ConditionsStreamHandlers;
      const fakeSubscribe = (_siteId: string, h: ConditionsStreamHandlers) => {
        handlers = h;
        return () => {};
      };

      wrap(<ConditionsPanel siteId="s1" subscribe={fakeSubscribe} loadHistory={pendingHistory} />);

      await act(async () => { vi.advanceTimersByTime(100); });

      act(() => {
        handlers.onStatus("live");
        handlers.onSnapshot(
          {
            siteId: "s1", asOf: "2026-08-06T07:40:12Z", activeShift: null, lightning: null,
            conditions: {
              wbgt: 31, currentBand: null, forecastBand: null, forecastWbgt30m: null,
              temperature: 33, humidity: 70, windSpeed: 2, rainfall: 0,
              observedAt: "2026-08-06T07:40:00Z", source: "NEA", freshness,
            },
          },
          [],
        );
      });

      const badge = screen.getByText(expectedText);
      expect(badge.tagName).toBe("OUTPUT");
      expect(badge).toHaveClass(`conditions-panel__badge conditions-panel__badge--${freshness.toLowerCase()}`);
    },
  );
});

describe("ConditionsPanel — four-hour history", () => {
  it("labels the trend window and keeps a chart-specific loading state", async () => {
    let handlers!: ConditionsStreamHandlers;
    const subscribe = vi.fn((_siteId: string, next: ConditionsStreamHandlers) => {
      handlers = next;
      return () => undefined;
    });

    wrap(<ConditionsPanel siteId="s1" subscribe={subscribe} loadHistory={pendingHistory} />);
    await waitFor(() => expect(subscribe).toHaveBeenCalledOnce());

    act(() => {
      handlers.onStatus("live");
      handlers.onSnapshot(liveSnapshot(29.1, "2026-08-20T08:45:00Z"), []);
    });

    expect(screen.getByRole("heading", { name: "WBGT Heat Stress Trend — Last 4 hours" }))
      .toBeInTheDocument();
    expect(screen.getByText("Loading the last 4 hours of WBGT readings..."))
      .toBeInTheDocument();
  });

  it("keeps live data visible and reports a history-only failure", async () => {
    let handlers!: ConditionsStreamHandlers;
    const subscribe = vi.fn((_siteId: string, next: ConditionsStreamHandlers) => {
      handlers = next;
      return () => undefined;
    });
    const unavailableHistory = async () => {
      throw new Error("history unavailable");
    };

    wrap(
      <ConditionsPanel
        siteId="s1"
        subscribe={subscribe}
        loadHistory={unavailableHistory}
      />,
    );
    await waitFor(() => expect(subscribe).toHaveBeenCalledOnce());

    act(() => {
      handlers.onStatus("live");
      handlers.onSnapshot(liveSnapshot(29.1, "2026-08-20T08:45:00Z"), []);
    });

    expect(screen.getByText("29.1 °C")).toBeInTheDocument();
    const notice = await screen.findByText(
      "Historical readings unavailable — showing live updates only.",
    );
    expect(notice.tagName).toBe("OUTPUT");
  });
});
