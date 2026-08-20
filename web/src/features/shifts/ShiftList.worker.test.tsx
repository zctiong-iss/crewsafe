/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { AuthProvider } from "@/auth/AuthProvider";
import { fakeUserManager } from "@/test/fakeUserManager";
import { server } from "@/test/mocks/server";
import { App } from "@/app/App";
import "@testing-library/jest-dom/vitest";

/**
 * What a worker sees at /shifts.
 *
 * A supervisor's board and a worker's board answer different questions. A supervisor asks
 * "who is exposed at this site today"; a worker asks "where am I meant to be". The list is
 * therefore scoped to the worker's own assignments, and the crew table to their own row —
 * not as a security control (the API is the control) but because a roster of colleagues is
 * not theirs to read. SiteController enforces that: /sites/{id}/workers is supervisor-only.
 */

const WORKER_ONE = "00000000-0000-4000-8000-000000000001";
const WORKER_TWO = "00000000-0000-4000-8000-000000000002";

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={["/shifts"]}>
      <AuthProvider userManager={fakeUserManager({})}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

/**
 * Sign in as Worker One, and close the roster endpoint the way the real backend closes it.
 *
 * The default handler answers /workers for anyone, which is more permissive than
 * SiteController's `hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN')`. Mirroring the 403
 * here is the point: a mock kinder than production lets a page pass its tests and 403 in a
 * browser.
 */
function signInAsWorkerOne() {
  server.use(
    http.get("*/api/v1/me", () =>
      HttpResponse.json({
        id: WORKER_ONE,
        username: "worker-one",
        displayName: "Worker One",
        role: "WORKER",
        siteIds: ["site-1"],
      }),
    ),
    http.get("*/api/v1/sites/:siteId/workers", () =>
      HttpResponse.json(
        { error: "Forbidden", message: "Access denied.", requestId: "test-request-id" },
        { status: 403 },
      ),
    ),
  );
}

/** Two shifts at site-1: one Worker One is on (10 Aug), one they are not (11 Aug). */
function twoShiftsOneOfThemMine() {
  server.use(
    http.get("*/api/v1/sites/:siteId/shifts", () =>
      HttpResponse.json([
        {
          id: "shift-mine",
          siteId: "site-1",
          startsAt: "2030-08-10T00:00:00Z",
          endsAt: "2030-08-10T08:00:00Z",
          status: "PLANNED",
          assignments: [
            { id: "a-mine", workerId: WORKER_ONE, intensity: "MODERATE", taskName: "Grass Cutting", acclimatisationDay: 2 },
            { id: "a-crewmate", workerId: WORKER_TWO, intensity: "HEAVY", taskName: "Formwork", acclimatisationDay: 1 },
          ],
        },
        {
          id: "shift-theirs",
          siteId: "site-1",
          startsAt: "2030-08-11T00:00:00Z",
          endsAt: "2030-08-11T08:00:00Z",
          status: "PLANNED",
          assignments: [
            { id: "a-theirs", workerId: WORKER_TWO, intensity: "LIGHT", taskName: "Signage", acclimatisationDay: 3 },
          ],
        },
      ]),
    ),
  );
}

describe("ShiftList as a worker", () => {
  it("renders the board even though the roster endpoint is closed to workers", async () => {
    signInAsWorkerOne();
    renderApp();

    // The shifts call succeeds; only the roster call is refused. One forbidden
    // enrichment must not take the page down with it.
    expect(await screen.findByText(/10 Aug/)).toBeInTheDocument();
    expect(screen.queryByText("Could not load shifts")).toBeNull();
  });

  it("lists only the shifts the worker is assigned to", async () => {
    signInAsWorkerOne();
    twoShiftsOneOfThemMine();
    renderApp();

    expect(await screen.findByText(/10 Aug/)).toBeInTheDocument();
    expect(screen.queryByText(/11 Aug/)).toBeNull();
  });

  it("titles the page for the person reading it", async () => {
    signInAsWorkerOne();
    renderApp();

    expect(await screen.findByRole("heading", { name: "My Shifts & Tasks" })).toBeInTheDocument();
  });

  it("offers a worker no way to create a shift", async () => {
    signInAsWorkerOne();
    renderApp();
    await screen.findByText(/10 Aug/);

    expect(screen.queryByRole("link", { name: "Create New Shift" })).toBeNull();
  });

  it("opens the worker's own shift without a click", async () => {
    signInAsWorkerOne();
    renderApp();

    // Their shift is the reason they opened the page — it should not need a disclosure click.
    expect(await screen.findByRole("button", { name: "Hide crew" })).toBeInTheDocument();
  });

  it("marks the shift as the worker's own", async () => {
    signInAsWorkerOne();
    renderApp();

    expect(await screen.findByText("Your Shift")).toBeInTheDocument();
  });

  it("shows the worker only their own row in the crew table", async () => {
    signInAsWorkerOne();
    twoShiftsOneOfThemMine();
    renderApp();
    await screen.findByRole("button", { name: "Hide crew" });

    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(2); // header + their own row
    expect(screen.getByText("Grass Cutting")).toBeInTheDocument();
    expect(screen.queryByText("Formwork")).toBeNull(); // a colleague's task
  });

  it("names the worker from their session rather than the roster", async () => {
    signInAsWorkerOne();
    twoShiftsOneOfThemMine();
    renderApp();
    await screen.findByRole("button", { name: "Hide crew" });

    // /workers 403s, so this name can only have come from the signed-in session.
    // Scoped to the table — their name also appears in the shell's account block.
    expect(within(screen.getByRole("table")).getByText(/Worker One/)).toBeInTheDocument();
  });

  it("still reports the full crew size on the card", async () => {
    signInAsWorkerOne();
    twoShiftsOneOfThemMine();
    renderApp();

    // The table is scoped to them; the headcount is not. A worker should know
    // how many people are on site with them during the same heat window.
    expect(await screen.findByText("2 workers")).toBeInTheDocument();
  });

  it("offers a worker no way to draft a plan", async () => {
    signInAsWorkerOne();
    renderApp();
    await screen.findByText(/10 Aug/);

    // Drafting a plan is a supervisor decision (canManage-gated), same as Edit.
    expect(screen.queryByRole("button", { name: "Draft Plan" })).toBeNull();
  });

  it("tells a worker with nothing assigned that they are not on any shift", async () => {
    signInAsWorkerOne();
    server.use(
      http.get("*/api/v1/sites/:siteId/shifts", () =>
        HttpResponse.json([
          {
            id: "shift-theirs",
            siteId: "site-1",
            startsAt: "2030-08-11T00:00:00Z",
            endsAt: "2030-08-11T08:00:00Z",
            status: "PLANNED",
            assignments: [
              { id: "a-theirs", workerId: WORKER_TWO, intensity: "LIGHT", taskName: "Signage", acclimatisationDay: 3 },
            ],
          },
        ]),
      ),
    );
    renderApp();

    // Not "No shifts yet" — the site has one. It is just not theirs.
    expect(await screen.findByText("No shifts assigned")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create New Shift" })).toBeNull();
  });
});
