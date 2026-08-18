/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { AuthProvider } from "@/auth/AuthProvider";
import { fakeUserManager } from "@/test/fakeUserManager";
import { server } from "@/test/mocks/server";
import { App } from "@/app/App";
import "@testing-library/jest-dom/vitest";

const BASE = "http://localhost:8080";

// /insights is manager-only; the default MSW /me is a SUPERVISOR, so override it or RoleRoute
// redirects away before the page mounts.
function asSafetyManager() {
  server.use(
    http.get(`${BASE}/api/v1/me`, () =>
      HttpResponse.json({
        id: "u-1",
        username: "manager",
        displayName: "Manager",
        role: "SAFETY_MANAGER",
        siteIds: ["site-1"],
      }),
    ),
  );
}

const renderInsights = () =>
  render(
    <MemoryRouter initialEntries={["/insights"]}>
      <AuthProvider userManager={fakeUserManager({})}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

const seededReport = {
  siteId: "site-1",
  from: "2026-08-09T00:00:00Z",
  to: "2026-08-16T00:00:00Z",
  dispatched: 20,
  actedOn: 17,
  lapsed: 3,
  complianceRate: 0.85,
  p50ResponseSeconds: 40,
  p95ResponseSeconds: 110,
  compliance: [
    { label: "Mon", dispatched: 10, actedOn: 9, lapsed: 1 },
    { label: "Tue", dispatched: 10, actedOn: 8, lapsed: 2 },
  ],
  responseTimes: [
    { label: "0–1m", count: 12 },
    { label: "1–2m", count: 5 },
  ],
};

describe("InsightsPage", () => {
  it("shows the seeded compliance rate, dispatched count and p95 in the stat row", async () => {
    asSafetyManager();
    server.use(
      http.get(`${BASE}/api/v1/sites/:siteId/insights/compliance`, () =>
        HttpResponse.json(seededReport),
      ),
    );
    renderInsights();

    expect(await screen.findByText("85%")).toBeInTheDocument();
    expect(screen.getByText("110s")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("exposes the exact numbers in an accessible data table", async () => {
    asSafetyManager();
    server.use(
      http.get(`${BASE}/api/v1/sites/:siteId/insights/compliance`, () =>
        HttpResponse.json(seededReport),
      ),
    );
    renderInsights();

    const table = await screen.findByRole("table", { name: /compliance by day/i });
    expect(table).toHaveTextContent("Mon");
    expect(table).toHaveTextContent("9"); // Monday acted-on
  });
});
