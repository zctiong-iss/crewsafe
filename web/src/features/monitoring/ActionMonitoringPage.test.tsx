/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { AuthProvider } from "@/auth/AuthProvider";
import { useAuth } from "@/auth/useAuth";
import { fakeUserManager } from "@/test/fakeUserManager";
import { server } from "@/test/mocks/server";
import { SiteProvider } from "@/site/SiteProvider";
import { expectNoA11yViolations } from "@/test/a11y";
import type { ActionDispatch, ActionStatusStreamHandlers } from "@/api/actionStatusStream";
import type { Concern, ConcernStreamHandlers } from "@/api/concernStream";
import { ActionMonitoringPage } from "./ActionMonitoringPage";
import "@testing-library/jest-dom/vitest";

function WhenSignedIn({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  return state.status === "signed-in" ? <>{children}</> : null;
}

const oneDispatch: ActionDispatch = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  recommendationId: "550e8400-e29b-41d4-a716-446655440002",
  approvalId: null,
  workerId: "550e8400-e29b-41d4-a716-446655440003",
  actionCode: "HYDRATE",
  instruction: "Take a 10 minute water break",
  startTime: null,
  endTime: null,
  status: "PENDING",
  dispatchedAt: "2026-08-20T08:00:00Z",
  lateAt: null,
  completedBy: null,
};

const oneConcern: Concern = {
  id: "550e8400-e29b-41d4-a716-446655440011",
  shiftId: "550e8400-e29b-41d4-a716-446655440012",
  workerId: "550e8400-e29b-41d4-a716-446655440013",
  symptoms: ["DIZZINESS"],
  note: "Feeling faint",
  status: "OPEN",
  raisedAt: "2026-08-20T08:00:00Z",
  acknowledgedAt: null,
};

// Injected transport: emits one committed live tick, exactly as the real stream would after
// its first alert-count. No network, no timers.
const liveSubscribe = (_siteId: string, handlers: ActionStatusStreamHandlers) => {
  handlers.onStatus("live");
  handlers.onTick([oneDispatch], {
    siteId: "site-1",
    pending: 1,
    late: 0,
    acknowledged: 0,
    completed: 0,
    asOf: "2026-08-20T08:00:10Z",
  });
  return () => {};
};

const liveConcernSubscribe = (_siteId: string, handlers: ConcernStreamHandlers) => {
  handlers.onStatus("live");
  handlers.onSnapshot([oneConcern]);
  return () => {};
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <AuthProvider userManager={fakeUserManager({})}>
        <WhenSignedIn>
          <SiteProvider>
            <ActionMonitoringPage
              subscribe={liveSubscribe}
              subscribeConcerns={liveConcernSubscribe}
            />
          </SiteProvider>
        </WhenSignedIn>
      </AuthProvider>
    </MemoryRouter>,
  );

const asMultiSite = () =>
  server.use(
    http.get("*/api/v1/me", () =>
      HttpResponse.json({
        id: "u-1", username: "supervisor", displayName: "Supervisor",
        role: "SUPERVISOR", siteIds: ["site-1", "site-2"],
      }),
    ),
  );

const asNoSite = () =>
  server.use(
    http.get("*/api/v1/me", () =>
      HttpResponse.json({
        id: "u-1", username: "unassigned", displayName: "Unassigned",
        role: "WORKER", siteIds: [],
      }),
    ),
  );

describe("ActionMonitoringPage", () => {
  it("shows an empty state when the user has no site assigned", async () => {
    asNoSite();
    renderPage();
    expect(await screen.findByText("No site assigned")).toBeInTheDocument();
  });

  it("renders the live dispatch board once a tick commits", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "Action Monitoring" })).toBeInTheDocument();
    // The committed tick's one PENDING dispatch surfaces in its bucket.
    expect(await screen.findByRole("heading", { name: /Pending/i })).toBeInTheDocument();
    expect(screen.getByText("HYDRATE")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Urgent worker concerns/i })).toBeInTheDocument();
    expect(screen.getByText(/Feeling faint/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /acknowledge/i })).not.toBeInTheDocument();
  });

  it("shows no site switcher for a single-site user", async () => {
    renderPage();
    // "Action Monitoring" is both the page title and a nav label, so anchor on the heading.
    await screen.findByRole("heading", { level: 1, name: "Action Monitoring" });
    expect(screen.queryByRole("combobox", { name: "Site" })).not.toBeInTheDocument();
  });

  it("lets a multi-site user switch which site's dispatches are shown", async () => {
    asMultiSite();
    const user = userEvent.setup();
    renderPage();

    const picker = await screen.findByRole("combobox", { name: "Site" });
    expect(screen.getByRole("option", { name: "Bishan Park Landscaping" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "NUS Campus Maintenance" })).toBeInTheDocument();
    expect(picker).toHaveValue("site-1");

    await user.selectOptions(picker, "site-2");
    expect(picker).toHaveValue("site-2");
  });

  it("has no accessibility violations", async () => {
    const { container } = renderPage();

    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});
