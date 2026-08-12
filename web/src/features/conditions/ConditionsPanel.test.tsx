/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "@/auth/AuthProvider";
import { fakeUserManager } from "@/test/fakeUserManager";
import type { ConditionsStreamHandlers } from "@/api/conditionsStream";
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
    wbgt, temperature: 33, humidity: 70, windSpeed: 2, rainfall: 0,
    observedAt, source: "NEA" as const, freshness: "LIVE" as const,
  },
});

describe("ConditionsPanel — degraded on staleness", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the stop-work banner above WBGT and auto-clears when expired", async () => {
    let handlers!: ConditionsStreamHandlers;
    const fakeSubscribe = (_siteId: string, h: ConditionsStreamHandlers) => {
      handlers = h;
      return () => {};
    };

    wrap(<ConditionsPanel siteId="s1" subscribe={fakeSubscribe} />);

    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      handlers.onStatus("live");
      handlers.onSnapshot({
        siteId: "s1", asOf: "2026-08-06T07:40:12Z", activeShift: null,
        conditions: {
          wbgt: 31, temperature: 33, humidity: 70, windSpeed: 2, rainfall: 0,
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

    wrap(<ConditionsPanel siteId="s1" subscribe={fakeSubscribe} />);

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

    wrap(<ConditionsPanel siteId="s1" subscribe={fakeSubscribe} />);
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