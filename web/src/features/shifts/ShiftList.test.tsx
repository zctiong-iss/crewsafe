/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect, vi } from "vitest";
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
    const GHOST = "00000000-0000-4000-8000-0000000000ff"; // absent from the workers handler
    server.use(
      http.get("*/api/v1/sites/:siteId/shifts", () =>
        HttpResponse.json([
          {
            id: "shift-ghost",
            siteId: "site-1",
            startsAt: "2026-08-10T00:00:00Z",
            endsAt: "2026-08-10T08:00:00Z",
            status: "PLANNED",
            assignments: [
              { id: "a-ghost", workerId: GHOST, intensity: "HEAVY", taskName: "Formwork", acclimatisationDay: 1 },
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
    expect(warn).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining([GHOST]));

    warn.mockRestore();
  });
});