/** @author Tang Chee Seng (with assistance from Claude & ChatGPT) */
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { AuthProvider } from "@/auth/AuthProvider";
import { fakeUserManager } from "@/test/fakeUserManager";
import { server } from "@/test/mocks/server";
import { expectNoA11yViolations } from "@/test/a11y";
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

  it("filters displayed statuses and orders shifts within each status", async () => {
    server.use(
      http.get("*/api/v1/sites/:siteId/shifts", () =>
        HttpResponse.json([
          { id: "planned-late", siteId: "site-1", startsAt: "2030-08-22T00:00:00Z", endsAt: "2030-08-22T08:00:00Z", status: "PLANNED", assignments: [] },
          { id: "cancelled-old", siteId: "site-1", startsAt: "2020-08-05T00:00:00Z", endsAt: "2020-08-05T08:00:00Z", status: "CANCELLED", assignments: [] },
          { id: "ended-old", siteId: "site-1", startsAt: "2020-08-01T00:00:00Z", endsAt: "2020-08-01T08:00:00Z", status: "PLANNED", assignments: [] },
          { id: "closed-recent", siteId: "site-1", startsAt: "2020-08-04T00:00:00Z", endsAt: "2020-08-04T08:00:00Z", status: "CLOSED", assignments: [] },
          { id: "active", siteId: "site-1", startsAt: "2020-08-20T00:00:00Z", endsAt: "2030-08-20T08:00:00Z", status: "PLANNED", assignments: [] },
          { id: "planned-early", siteId: "site-1", startsAt: "2030-08-21T00:00:00Z", endsAt: "2030-08-21T08:00:00Z", status: "PLANNED", assignments: [] },
          { id: "cancelled-recent", siteId: "site-1", startsAt: "2020-08-06T00:00:00Z", endsAt: "2020-08-06T08:00:00Z", status: "CANCELLED", assignments: [] },
          { id: "ended-recent", siteId: "site-1", startsAt: "2020-08-02T00:00:00Z", endsAt: "2020-08-02T08:00:00Z", status: "PLANNED", assignments: [] },
          { id: "closed-old", siteId: "site-1", startsAt: "2020-08-03T00:00:00Z", endsAt: "2020-08-03T08:00:00Z", status: "CLOSED", assignments: [] },
        ]),
      ),
    );

    const user = userEvent.setup();
    renderApp();

    const visibleStartDates = () => Array.from(
      screen.getByRole("region", { name: "Shifts" }).querySelectorAll(".shift-card__range"),
    ).map((range) => range.textContent?.match(/\d{1,2} Aug 20\d{2}/)?.[0]);

    const currentList = await screen.findByRole("region", { name: "Shifts" });
    expect(within(currentList).getByText("Active")).toBeInTheDocument();
    expect(within(currentList).getAllByText("Planned")).toHaveLength(2);
    expect(within(currentList).queryByText("Ended")).not.toBeInTheDocument();
    expect(within(currentList).queryByText("Closed")).not.toBeInTheDocument();
    expect(visibleStartDates()).toEqual(["20 Aug 2020", "21 Aug 2030", "22 Aug 2030"]);

    await user.click(screen.getByRole("button", { name: "All" }));

    const allShifts = screen.getByRole("region", { name: "Shifts" });
    expect(within(allShifts).getAllByText("Ended")).toHaveLength(2);
    expect(within(allShifts).getAllByText("Closed")).toHaveLength(2);
    expect(visibleStartDates()).toEqual([
      "20 Aug 2020", "21 Aug 2030", "22 Aug 2030",
      "6 Aug 2020", "5 Aug 2020",
      "4 Aug 2020", "3 Aug 2020",
      "2 Aug 2020", "1 Aug 2020",
    ]);

    await user.click(screen.getByRole("button", { name: "Live" }));
    expect(visibleStartDates()).toEqual(["20 Aug 2020"]);

    await user.click(screen.getByRole("button", { name: "Planned" }));
    expect(visibleStartDates()).toEqual(["21 Aug 2030", "22 Aug 2030"]);

    await user.click(screen.getByRole("button", { name: "Ended" }));
    expect(visibleStartDates()).toEqual(["2 Aug 2020", "1 Aug 2020"]);

    await user.click(screen.getByRole("button", { name: "Closed" }));
    expect(visibleStartDates()).toEqual(["4 Aug 2020", "3 Aug 2020"]);

    await user.click(screen.getByRole("button", { name: "Cancelled" }));
    expect(visibleStartDates()).toEqual(["6 Aug 2020", "5 Aug 2020"]);
  });

  it("groups the filter tabs in a native fieldset", async () => {
    renderApp();

    const filterGroup = await screen.findByRole("group", { name: "Filter shifts" });
    expect(filterGroup.tagName).toBe("FIELDSET");
  });

  it("does not offer Draft Plan for an ended shift", async () => {
    server.use(
      http.get("*/api/v1/sites/:siteId/shifts", () =>
        HttpResponse.json([
          { id: "ended", siteId: "site-1", startsAt: "2020-08-19T08:00:00Z", endsAt: "2020-08-19T16:00:00Z", status: "PLANNED", assignments: [] },
        ]),
      ),
    );

    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "All" }));

    const endedCard = screen.getByText(/19 Aug 2020/).closest("article");
    expect(endedCard).not.toBeNull();
    expect(within(endedCard!).queryByRole("button", { name: "Draft Plan" })).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderApp();

    // Mounts the whole App at /shifts, so axe also sees the shell's nav landmarks, not just the list.
    expect(await screen.findByText(/10 Aug/)).toBeInTheDocument();
    await expectNoA11yViolations(container);
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
          startsAt: "2030-08-10T00:00:00Z", endsAt: "2030-08-10T08:00:00Z",
          status: "PLANNED", assignments: [] },
      ]),
    ),
  );
  renderApp();
  expect(await screen.findByText("Bishan Park Landscaping")).toBeInTheDocument();
  expect(await screen.findByText("NUS Campus Maintenance")).toBeInTheDocument();
});

  it("renders the loading message as an <output> status region (SCRUM-420 / S6819)", async () => {
    server.use(http.get("*/api/v1/sites/:siteId/shifts", () => new Promise(() => {})));
    renderApp();

    const status = await screen.findByText("Loading shifts…");
    expect(status.tagName).toBe("OUTPUT");
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
            startsAt: "2030-08-10T00:00:00Z",
            endsAt: "2030-08-10T08:00:00Z",
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
            startsAt: "2030-08-10T00:00:00Z",
            endsAt: "2030-08-10T08:00:00Z",
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
            startsAt: "2030-08-10T00:00:00Z",
            endsAt: "2030-08-10T08:00:00Z",
            status: "PLANNED",
            assignments: [
              { id: "a-1", workerId: "00000000-0000-4000-8000-000000000001", intensity: "MODERATE", taskName: "Grass Cutting", acclimatisationDay: 2 },
              { id: "a-2", workerId: "00000000-0000-4000-8000-000000000002", intensity: "HEAVY", taskName: "Formwork", acclimatisationDay: 1 },
            ],
          },
          {
            id: "shift-other",
            siteId: "site-1",
            startsAt: "2030-08-11T00:00:00Z",
            endsAt: "2030-08-11T08:00:00Z",
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

  describe("Draft Plan", () => {
    const GENERATE_URL = "*/api/v1/sites/:siteId/shifts/:shiftId/recommendations/generate";
    const draftPlanButton = { name: "Draft Plan" };

    it("offers a supervisor a Draft Plan button", async () => {
      renderApp();
      expect(await screen.findByRole("button", draftPlanButton)).toBeInTheDocument();
    });

    it("drafts a plan and links to Approvals on success", async () => {
      server.use(
        http.post(GENERATE_URL, () =>
          HttpResponse.json({
            id: "rec-1", shiftId: "shift-1", policyVersion: null, status: "PENDING_APPROVAL",
            rationale: null, createdAt: "2026-08-16T00:00:00Z", mitigations: [], approval: null,
            evidence: null, modelVersion: null,
          }),
        ),
      );
      const user = userEvent.setup();
      renderApp();
      await user.click(await screen.findByRole("button", draftPlanButton));

      expect(await screen.findByText(/Plan drafted/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "review it in Approvals" })).toHaveAttribute("href", "/approvals");
      // The button returns to its resting state rather than staying stuck on "Drafting…".
      expect(screen.getByRole("button", draftPlanButton)).not.toBeDisabled();
    });

    it("shows an error message when drafting a plan fails", async () => {
      server.use(
        http.post(GENERATE_URL, () =>
          HttpResponse.json(
            { error: "Server Error", message: "boom", requestId: "test-request-id" },
            { status: 500 },
          ),
        ),
      );
      const user = userEvent.setup();
      renderApp();
      await user.click(await screen.findByRole("button", draftPlanButton));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Something went wrong on our end. Try again in a moment.",
      );
    });

    it("disables the button while a plan is being drafted", async () => {
      server.use(
        http.post(GENERATE_URL, () => new Promise(() => {})),
      );
      const user = userEvent.setup();
      renderApp();
      await user.click(await screen.findByRole("button", draftPlanButton));

      expect(await screen.findByRole("button", { name: "Drafting…" })).toBeDisabled();
    });
  });
});
