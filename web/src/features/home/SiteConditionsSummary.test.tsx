/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { ConditionsSnapshot, ConditionsStreamHandlers } from "@/api/conditionsStream";
import { SiteConditionsSummary } from "./SiteConditionsSummary";
import "@testing-library/jest-dom/vitest";

// The fixture carries currentBand / forecastBand from the server — the component only PAINTS them,
// it never classifies wbgt. current=High, forecast=Extreme so the two chip labels are distinct.
const liveSnapshot = (wbgt: number, observedAt: string): ConditionsSnapshot => ({
  siteId: "550e8400-e29b-41d4-a716-446655440000",
  asOf: observedAt,
  activeShift: null,
  lightning: null,
  conditions: {
    wbgt, currentBand: "32_TO_BELOW_33", forecastBand: "33_AND_ABOVE", forecastWbgt30m: 33.2,
    temperature: 33, humidity: 70, windSpeed: 2, rainfall: 0,
    observedAt, source: "NEA", freshness: "LIVE",
  },
});

const capture = () => {
  let handlers!: ConditionsStreamHandlers;
  const subscribe = (_siteId: string, h: ConditionsStreamHandlers) => { handlers = h; return () => {}; };
  return { subscribe, get: () => handlers };
};

describe("SiteConditionsSummary", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the connecting state before any snapshot arrives", () => {
    const subscribe = () => () => {};
    render(<SiteConditionsSummary siteId="site-1" subscribe={subscribe} />);
    expect(screen.getByText(/Connecting to live conditions/i)).toBeInTheDocument();
  });

  it("paints the server-sent current band, freshness and forecast band", () => {
    const { subscribe, get } = capture();
    render(<SiteConditionsSummary siteId="site-1" subscribe={subscribe} />);

    act(() => {
      get().onStatus("live");
      get().onSnapshot(liveSnapshot(32.5, "2026-08-10T08:00:00Z"), []);
    });

    expect(screen.getByText(/32\.5\s*°C/)).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText(/High Heat Risk/)).toBeInTheDocument();      // currentBand chip
    expect(screen.getByText(/Next 30 min Forecast/i)).toBeInTheDocument();
    expect(screen.getByText(/Extreme Heat Risk/)).toBeInTheDocument();   // forecastBand chip
  });

  it("hides the forecast row when the server sent no forecast band", () => {
    const { subscribe, get } = capture();
    render(<SiteConditionsSummary siteId="site-1" subscribe={subscribe} />);

    act(() => {
      get().onStatus("live");
      const base = liveSnapshot(30, "2026-08-10T08:00:00Z");
      get().onSnapshot(
        { ...base, conditions: { ...base.conditions!, currentBand: "BELOW_31", forecastBand: null, forecastWbgt30m: null } },
        [],
      );
    });

    expect(screen.queryByText(/Next 30 min Forecast/i)).toBeNull();
    expect(screen.getByText(/Low Heat Risk/)).toBeInTheDocument();   // current band still shown
  });

  it("surfaces stop-work when lightning is active", () => {
    const { subscribe, get } = capture();
    render(<SiteConditionsSummary siteId="site-1" subscribe={subscribe} />);

    act(() => {
      get().onStatus("live");
      get().onSnapshot({
        ...liveSnapshot(31, "2026-08-10T08:00:00Z"),
        lightning: {
          state: "STOP_WORK", nearestStrikeKm: 5,
          observedAt: "2026-08-10T08:00:00Z",
          validUntil: new Date(Date.now() + 60_000).toISOString(),
          freshness: "LIVE",
        },
      }, []);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/Stop work/i);
  });

  it("marks an active shift in progress", () => {
    const { subscribe, get } = capture();
    render(<SiteConditionsSummary siteId="site-1" subscribe={subscribe} />);

    act(() => {
      get().onStatus("live");
      get().onSnapshot({
        ...liveSnapshot(31, "2026-08-10T08:00:00Z"),
        activeShift: { shiftId: "550e8400-e29b-41d4-a716-446655440000",
          startsAt: "2026-08-10T08:00:00Z", endsAt: "2026-08-10T16:00:00Z" },
      }, []);
    });

    expect(screen.getByText(/Active shift in progress/i)).toBeInTheDocument();
  });

  it("degrades to a warning after 40s of silence, keeping the last reading", () => {
    const { subscribe, get } = capture();
    render(<SiteConditionsSummary siteId="site-1" subscribe={subscribe} />);

    act(() => {
      get().onStatus("live");
      get().onSnapshot(liveSnapshot(31, "2026-08-10T08:00:00Z"), []);
    });
    expect(screen.queryByRole("alert")).toBeNull();

    act(() => { vi.advanceTimersByTime(41_000); });   // watchdog tips it to degraded
    expect(screen.getByRole("alert")).toHaveTextContent(/Live feed interrupted/i);
    expect(screen.getByText(/31\s*°C/)).toBeInTheDocument();   // last reading still shown
  });

  it("warns on an out-of-range WBGT and does not hide the number", () => {
    const { subscribe, get } = capture();
    render(<SiteConditionsSummary siteId="site-1" subscribe={subscribe} />);

    act(() => {
      get().onStatus("live");
      get().onSnapshot(liveSnapshot(37.2, "2026-08-10T08:00:00Z"),
        [{ metric: "wbgt", value: 37.2, minimum: 20, maximum: 36 }]);
    });

    expect(screen.getByText(/37\.2\s*°C/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/verify against official NEA data/i);
  });
});
