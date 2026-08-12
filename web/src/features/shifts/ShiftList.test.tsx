/** @author Tang Chee Seng (with assistance from Claude & ChatGPT) */
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { AuthProvider } from "@/auth/AuthProvider";
import { fakeUserManager } from "@/test/fakeUserManager";
import { server } from "@/test/mocks/server";
import { App } from "@/app/App";
import "@testing-library/jest-dom/vitest";

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={["/shifts"]}>
      <AuthProvider userManager={fakeUserManager({})}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ShiftList", () => {
  it("renders the site's shifts", async () => {
    renderApp();
    expect(await screen.findByText(/10 Aug/)).toBeInTheDocument();
    expect(screen.getByText("1 worker")).toBeInTheDocument();
  });

  it("expands a card to show its crew", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "Show crew" }));
    expect(screen.getByText("Worker One")).toBeInTheDocument();
    expect(screen.getByText("Moderate")).toBeInTheDocument();
    expect(screen.getByText("Grass Cutting")).toBeInTheDocument();
  });

  it("shows the worksite name on each shift card", async () => {
  renderApp();
  // site-1 → "Bishan Park Landscaping" per the sites handler in handlers.ts (Step 0)
  expect(await screen.findByText("Bishan Park Landscaping")).toBeInTheDocument();
});

it("lists shifts from every site the user belongs to", async () => {
  server.use(
    http.get("*/api/v1/me", () =>
      HttpResponse.json({
        id: "u-1", username: "supervisor", displayName: "Supervisor",
        role: "SUPERVISOR", siteIds: ["site-1", "site-2"],
      }),
    ),
    http.get("*/api/v1/sites/:siteId/shifts", ({ params }) =>
      HttpResponse.json([
        { id: `shift-${params.siteId}`, siteId: params.siteId,
          startsAt: "2026-08-10T00:00:00Z", endsAt: "2026-08-10T08:00:00Z",
          status: "PLANNED", assignments: [] },
      ]),
    ),
  );
  renderApp();
  expect(await screen.findByText("Bishan Park Landscaping")).toBeInTheDocument();
  expect(await screen.findByText("NUS Campus Maintenance")).toBeInTheDocument();
});

  it("offers a Create button when there are no shifts", async () => {
    server.use(http.get("*/api/v1/sites/:siteId/shifts", () => HttpResponse.json([])));
    renderApp();
    expect(await screen.findByText("No shifts yet")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Create New Shift" }).length).toBeGreaterThan(0);
  });

  it("flags and logs an assignment whose worker is not in the roster", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const SAMPLE_MISSING_WORKER_ID = "00000000-0000-4000-8000-0000000000ff"; // absent from the workers handler
    server.use(
      http.get("*/api/v1/sites/:siteId/shifts", () =>
        HttpResponse.json([
          {
            id: "shift-sample-missing-worker",
            siteId: "site-1",
            startsAt: "2026-08-10T00:00:00Z",
            endsAt: "2026-08-10T08:00:00Z",
            status: "PLANNED",
            assignments: [
              { id: "a-sample-missing-worker", workerId: SAMPLE_MISSING_WORKER_ID, intensity: "HEAVY", taskName: "Formwork", acclimatisationDay: 1 },
            ],
          },
        ]),
      ),
    );

    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "Show crew" }));

    const placeholder = screen.getByText("Worker not found");
    expect(placeholder).toBeInTheDocument();                         // surfaced, not hidden
    expect(placeholder).toHaveClass("shift-card__worker--missing");  // visible cue applied
    expect(warn).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining([SAMPLE_MISSING_WORKER_ID]));

    warn.mockRestore();
  });

  it("does not log a missing worker identifier outside development", async () => {
    vi.stubEnv("DEV", false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const SAMPLE_MISSING_WORKER_ID = "00000000-0000-4000-8000-0000000000ff";
    server.use(
      http.get("*/api/v1/sites/:siteId/shifts", () =>
        HttpResponse.json([
          {
            id: "shift-production-sample-missing-worker",
            siteId: "site-1",
            startsAt: "2026-08-10T00:00:00Z",
            endsAt: "2026-08-10T08:00:00Z",
            status: "PLANNED",
            assignments: [
              { id: "a-production-sample-missing-worker", workerId: SAMPLE_MISSING_WORKER_ID, intensity: "HEAVY", taskName: "Formwork", acclimatisationDay: 1 },
            ],
          },
        ]),
      ),
    );

    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "Show crew" }));
    expect(await screen.findByText("Worker not found")).toBeInTheDocument();
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  // A crew shift at site-1 that the signed-in supervisor (u-1) is not assigned to.
  const crewOfTwo = () =>
    server.use(
      http.get("*/api/v1/sites/:siteId/shifts", () =>
        HttpResponse.json([
          {
            id: "shift-crew",
            siteId: "site-1",
            startsAt: "2026-08-10T00:00:00Z",
            endsAt: "2026-08-10T08:00:00Z",
            status: "PLANNED",
            assignments: [
              { id: "a-1", workerId: "00000000-0000-4000-8000-000000000001", intensity: "MODERATE", taskName: "Grass Cutting", acclimatisationDay: 2 },
              { id: "a-2", workerId: "00000000-0000-4000-8000-000000000002", intensity: "HEAVY", taskName: "Formwork", acclimatisationDay: 1 },
            ],
          },
          {
            id: "shift-other",
            siteId: "site-1",
            startsAt: "2026-08-11T00:00:00Z",
            endsAt: "2026-08-11T08:00:00Z",
            status: "PLANNED",
            assignments: [
              { id: "a-3", workerId: "00000000-0000-4000-8000-000000000002", intensity: "LIGHT", taskName: "Signage", acclimatisationDay: 3 },
            ],
          },
        ]),
      ),
    );

  // The worker-scoped view narrows this list and this table; a supervisor's must stay whole.
  it("keeps every shift on the board for a supervisor", async () => {
    crewOfTwo();
    renderApp();

    expect(await screen.findByText(/10 Aug/)).toBeInTheDocument();
    expect(screen.getByText(/11 Aug/)).toBeInTheDocument();
  });

  it("shows a supervisor the whole crew, not one row", async () => {
    crewOfTwo();
    const user = userEvent.setup();
    renderApp();
    const [firstCard] = await screen.findAllByRole("button", { name: "Show crew" });
    await user.click(firstCard!);

    expect(screen.getByText("Grass Cutting")).toBeInTheDocument();
    expect(screen.getByText("Formwork")).toBeInTheDocument();
  });

  /**
   * The side-by-side crew layout is pure CSS, keyed off .shift-card--open. jsdom resolves
   * no media queries, so the class toggle is the contract worth pinning — if it survives,
   * the stylesheet has something to hook.
   */
  it("toggles the modifier class the expanded layout keys off", async () => {
    const user = userEvent.setup();
    renderApp();
    const card = await screen.findByRole("article");
    expect(card).not.toHaveClass("shift-card--open");

    await user.click(screen.getByRole("button", { name: "Show crew" }));
    expect(card).toHaveClass("shift-card--open");

    await user.click(screen.getByRole("button", { name: "Hide crew" }));
    expect(card).not.toHaveClass("shift-card--open");
  });
});
