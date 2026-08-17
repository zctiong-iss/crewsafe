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

// /audit is manager-only (SAFETY_MANAGER + ADMIN); the default MSW /me is a SUPERVISOR, so it must
// be overridden or RoleRoute redirects away before the page ever mounts.
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

const renderAudit = () =>
  render(
    <MemoryRouter initialEntries={["/audit"]}>
      <AuthProvider userManager={fakeUserManager({})}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

const seededPage = {
  siteId: "site-1",
  from: "2026-08-09T00:00:00Z",
  to: "2026-08-16T00:00:00Z",
  page: 0,
  pageSize: 50,
  totalEntries: 2,
  entries: [
    {
      occurredAt: "2026-08-15T02:00:00Z",
      actorName: "Aisha Rahman",
      eventLabel: "Shift created",
      eventType: "SHIFT_CREATED",
      targetType: "SHIFT",
      targetId: "s-1",
      correlationId: "req-abc",
      detail: null,
    },
    {
      occurredAt: "2026-08-15T03:00:00Z",
      actorName: "system / unauthenticated",
      eventLabel: "Access denied",
      eventType: "ACCESS_DENIED",
      targetType: "SITE",
      targetId: "site-9",
      correlationId: "req-def",
      detail: "wrong site",
    },
  ],
};

describe("AuditPage", () => {
  it("renders the assembled timeline with actor, event and trace id", async () => {
    asSafetyManager();
    server.use(
      http.get(`${BASE}/api/v1/sites/:siteId/audit`, () => HttpResponse.json(seededPage)),
    );
    renderAudit();

    expect(await screen.findByText("Shift created")).toBeInTheDocument();
    expect(screen.getByText("Aisha Rahman")).toBeInTheDocument();
    expect(screen.getByText("req-abc")).toBeInTheDocument();
    // A null source actor is rendered honestly, never a blank cell.
    expect(screen.getByText("system / unauthenticated")).toBeInTheDocument();
  });

  it("shows an honest empty state when nothing was recorded", async () => {
    asSafetyManager();
    server.use(
      http.get(`${BASE}/api/v1/sites/:siteId/audit`, () =>
        HttpResponse.json({ ...seededPage, totalEntries: 0, entries: [] }),
      ),
    );
    renderAudit();

    expect(await screen.findByText("No audit events in this range")).toBeInTheDocument();
  });
});
