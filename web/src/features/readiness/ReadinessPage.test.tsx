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

// Default MSW /me resolves to SUPERVISOR, which /readiness admits — so no /me override needed here.
const renderReadiness = () =>
  render(
    <MemoryRouter initialEntries={["/readiness"]}>
      <AuthProvider userManager={fakeUserManager({})}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

const summary = {
  siteId: "site-1",
  shifts: [
    {
      shiftId: "sh-1",
      startsAt: "2026-08-17T00:00:00Z",
      endsAt: "2026-08-17T08:00:00Z",
      status: "PLANNED",
      submitted: 1,
      stale: 1,
      missing: 1,
      workers: [
        {
          workerId: "w1",
          displayName: "Aisha Rahman",
          status: "SUBMITTED",
          fitToWork: true,
          submittedAt: "2026-08-16T22:00:00Z",
          flaggedSymptom: false,
        },
        {
          workerId: "w2",
          displayName: "Bilal Osman",
          status: "STALE",
          fitToWork: true,
          submittedAt: "2026-08-15T09:00:00Z",
          flaggedSymptom: false,
        },
        {
          workerId: "w3",
          displayName: "Chen Wei",
          status: "MISSING",
          fitToWork: null,
          submittedAt: null,
          flaggedSymptom: false,
        },
      ],
    },
  ],
};

describe("ReadinessPage", () => {
  it("flags the stale and missing workers and the follow-up count", async () => {
    server.use(
      http.get(`${BASE}/api/v1/sites/:siteId/readiness-summary`, () =>
        HttpResponse.json(summary),
      ),
    );
    renderReadiness();

    // The follow-up pill = stale + missing.
    expect(await screen.findByText("2 to follow up")).toBeInTheDocument();
    // Per-worker status pills (exact, so "1 missing"/"1 stale" counts do not collide).
    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Chen Wei")).toBeInTheDocument();
  });

  it("shows an honest empty state when there are no upcoming shifts", async () => {
    server.use(
      http.get(`${BASE}/api/v1/sites/:siteId/readiness-summary`, () =>
        HttpResponse.json({ siteId: "site-1", shifts: [] }),
      ),
    );
    renderReadiness();

    expect(await screen.findByText("No upcoming shifts")).toBeInTheDocument();
  });
});
