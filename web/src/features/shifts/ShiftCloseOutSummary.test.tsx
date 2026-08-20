/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { AuthProvider } from "@/auth/AuthProvider";
import { fakeUserManager } from "@/test/fakeUserManager";
import { App } from "@/app/App";
import type { Shift } from "@/api/shifts";
import type { ShiftCloseSummary } from "@/api/shiftSummary";
import { expectNoA11yViolations } from "@/test/a11y";
import "@testing-library/jest-dom/vitest";

const BASE = "http://localhost:8080";
const SUMMARY_URL = `${BASE}/api/v1/sites/site-1/shifts/s-1/summary`;

const shift: Shift = {
  id: "s-1",
  siteId: "site-1",
  startsAt: "2026-08-20T00:00:00Z",
  endsAt: "2026-08-20T08:00:00Z",
  status: "CLOSED",
  assignments: [],
};

const summary: ShiftCloseSummary = {
  shiftId: "s-1",
  siteId: "site-1",
  siteName: "Tuas Yard",
  startsAt: shift.startsAt,
  endsAt: shift.endsAt,
  status: "CLOSED",
  localRange: "20 Aug 2026 08:00–16:00 Asia/Singapore",
  workerCount: 4,
  closedAt: "2026-08-20T08:05:00Z",
  closedByName: "Priya Nair",
  conditions: { readinessSubmissions: 6, peakWbgt: 32.4, peakBand: "32_TO_BELOW_33" },
  actions: { issued: 5, acknowledged: 4, completed: 5, exceptions: 2 },
  totalAuditEvents: 21,
  eventCountsByType: { SHIFT_CREATED: 1 },
};

function renderWith(state: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/shifts/s-1/summary", state }]}>
      <AuthProvider userManager={fakeUserManager({})}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ShiftCloseOutSummary", () => {
  it("renders the audit-derived buckets, peak band, range and closed-by line", async () => {
    server.use(http.get(SUMMARY_URL, () => HttpResponse.json(summary)));

    renderWith({ shift });

    await screen.findByText("High Heat Risk · 32–33 °C (32.4 °C)");
    expect(screen.getByText("Closed by Priya Nair")).toBeInTheDocument();
    expect(screen.getByText("Issued").closest(".closeout__stat")).toHaveTextContent("5");
    expect(screen.getByText("Exceptions").closest(".closeout__stat")).toHaveTextContent("2");
    expect(screen.getByText("Readiness submissions").closest(".closeout__stat")).toHaveTextContent("6");
    expect(screen.getByText(/Reconciled against 21 audit events/)).toBeInTheDocument();
  });

  it("shows an honest 'No readings' when the shift window had no observation", async () => {
    server.use(http.get(SUMMARY_URL, () =>
      HttpResponse.json({ ...summary, conditions: { readinessSubmissions: 0 } })));

    renderWith({ shift });

    expect(await screen.findByText(/No readings in the shift window/)).toBeInTheDocument();
  });

  it("says the shift is not yet closed when there is no close event", async () => {
    server.use(http.get(SUMMARY_URL, () =>
      HttpResponse.json({ ...summary, status: "ACTIVE", closedAt: undefined, closedByName: undefined })));

    renderWith({ shift });

    expect(await screen.findByText("Not yet formally closed")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    server.use(http.get(SUMMARY_URL, () => HttpResponse.json(summary)));

    const { container } = renderWith({ shift });
    await screen.findByText(/Reconciled against/);

    await expectNoA11yViolations(container);
  });

  it("guides back to Shifts when opened without a selected shift", async () => {
    renderWith(undefined);

    expect(await screen.findByText(/Select a shift from the list/)).toBeInTheDocument();
  });
});
