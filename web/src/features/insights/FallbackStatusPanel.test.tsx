/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { FallbackStatusPanel } from "./FallbackStatusPanel";
import "@testing-library/jest-dom/vitest";

const BASE = "http://localhost:8080";

const forecast = (basis: string, degraded: boolean) => ({
  predictedValue: 31.5,
  horizonMinutes: 30,
  modelVersion: "wbgt-1.2.0",
  confidenceIntervalLower: 31.0,
  confidenceIntervalUpper: 32.0,
  generatedAt: "2026-08-16T08:00:00Z",
  basis,
  inputAgeMinutes: 12,
  degraded,
});

describe("FallbackStatusPanel", () => {
  it("labels a live model run without a degraded pill", async () => {
    server.use(
      http.get(`${BASE}/api/v1/sites/:siteId/weather/forecast`, () =>
        HttpResponse.json(forecast("MODEL", false)),
      ),
    );
    render(<FallbackStatusPanel siteId="site-1" />);
    expect(await screen.findByText("Live model")).toBeInTheDocument();
    expect(screen.queryByText("Running degraded")).toBeNull();
  });

  it("labels a persistence fallback and shows the degraded pill", async () => {
    server.use(
      http.get(`${BASE}/api/v1/sites/:siteId/weather/forecast`, () =>
        HttpResponse.json(forecast("PERSISTENCE", true)),
      ),
    );
    render(<FallbackStatusPanel siteId="site-1" />);
    expect(await screen.findByText("Last reading held")).toBeInTheDocument();
    expect(screen.getByText("Running degraded")).toBeInTheDocument();
  });

  it("shows an honest 'unavailable' state on a 503, not an error", async () => {
    server.use(
      http.get(
        `${BASE}/api/v1/sites/:siteId/weather/forecast`,
        () => new HttpResponse(null, { status: 503 }),
      ),
    );
    render(<FallbackStatusPanel siteId="site-1" />);
    expect(await screen.findByText(/No forecast available/i)).toBeInTheDocument();
  });
});
