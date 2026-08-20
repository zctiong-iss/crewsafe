/** @author Tang Chee Seng (with assistance from Claude and ChatGPT) */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { AuthProvider } from "@/auth/AuthProvider";
import { fakeUserManager } from "@/test/fakeUserManager";
import { server } from "@/test/mocks/server";
import { App } from "@/app/App";
import type { ShiftCreateRequest } from "@/api/shifts";
import "@testing-library/jest-dom/vitest";

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={["/shifts/new"]}>
      <AuthProvider userManager={fakeUserManager({})}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

const setDateTime = async (user: ReturnType<typeof userEvent.setup>, label: string, value: string) => {
  const input = screen.getByLabelText(label);
  await user.clear(input);
  await user.type(input, value);
};

const WORKER_ONE = "00000000-0000-4000-8000-000000000001";
const WORKER_TWO = "00000000-0000-4000-8000-000000000002";

async function addOneAssignment(user: ReturnType<typeof userEvent.setup>) {
  await setDateTime(user, "Starts at", "10 Aug 2026, 08:00");
  await setDateTime(user, "Ends at", "10 Aug 2026, 16:00");
  await user.click(screen.getByRole("button", { name: "Add worker" }));
  await user.selectOptions(screen.getByLabelText("Worker"), WORKER_ONE);
  await user.click(screen.getByRole("radio", { name: "Moderate" }));
}

function spyOnPost() {
  const calls: { count: number; bodies: ShiftCreateRequest[] } = { count: 0, bodies: [] };
  server.use(
    http.post("*/api/v1/sites/:siteId/shifts", async ({ request }) => {
      calls.count += 1;
      calls.bodies.push((await request.json()) as ShiftCreateRequest);
      return HttpResponse.json({ id: "shift-1", status: "PLANNED" }, { status: 201 });
    }),
  );
  return calls;
}

describe("CreateShiftForm", () => {
  it("AC-1 — creates a shift on the happy path", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByLabelText("Starts at");
    await addOneAssignment(user);
    await user.click(screen.getByRole("button", { name: "Create Shift" }));
    expect(await screen.findByText("Shift created")).toBeInTheDocument();
  });

  /**
   * The picker hands back a Date built in the HOST's zone, and toISOString() converts using
   * the HOST's offset — while the read path pins Asia/Singapore explicitly (formatShiftRange).
   * Nothing else in the suite looks at the body, so an eight-hour drift would ship silently.
   */
  it("sends the typed wall-clock time as the right instant", async () => {
    const posted = spyOnPost();
    const user = userEvent.setup();
    renderApp();
    await screen.findByLabelText("Starts at");
    await addOneAssignment(user);
    await user.click(screen.getByRole("button", { name: "Create Shift" }));
    await screen.findByText("Shift created");

    const [body] = posted.bodies;
    expect(body?.startsAt).toBe("2026-08-10T00:00:00.000Z"); // 08:00 SGT
    expect(body?.endsAt).toBe("2026-08-10T08:00:00.000Z");   // 16:00 SGT
  });

  it ("Changing worksite in Shift Creation Page clears the crew rows", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByLabelText("Worksite");
    await addOneAssignment(user);
    expect (screen.getByText("Worker 1")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Worksite"), "site-2");
    expect(screen.queryByText("Worker 1")).toBeNull();
    });

  it("Hide the 'Add worker' button when the selected worksite has no workers", async () => {
  server.use(
    http.get("*/api/v1/sites/:siteId/workers", ({ params }) =>
      HttpResponse.json(params.siteId === "site-2" ? [] : [
        { id: WORKER_ONE, displayName: "Worker One" },
      ]),
    ),
  );
  const user = userEvent.setup();
  renderApp();
  await user.selectOptions(await screen.findByLabelText("Worksite"), "site-2");

  const note = await screen.findByText(/No workers are assigned/i);
  expect(note).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add worker" })).toBeNull();
  // SCRUM-420 / S6819 — this note must be a native <output> status region, not role=status.
  expect(note.tagName).toBe("OUTPUT");
  expect(note).toHaveClass("shift-form__note");
});

  it("renders the loading-workers message as an <output> status region (SCRUM-420 / S6819)", async () => {
    server.use(http.get("*/api/v1/sites/:siteId/workers", () => new Promise(() => {})));
    renderApp();

    const status = await screen.findByText("Loading workers…");
    expect(status.tagName).toBe("OUTPUT");
  });

  it("AC-2 — a reversed date order sends no request", async () => {
    const posted = spyOnPost();
    const user = userEvent.setup();
    renderApp();
    await screen.findByLabelText("Starts at");
    await setDateTime(user, "Starts at", "10 Aug 2026, 16:00");
    await setDateTime(user, "Ends at", "10 Aug 2026, 08:00");
    await user.click(screen.getByRole("button", { name: "Create Shift" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The shift must end after it starts.");
    expect(posted.count).toBe(0);
  });

  it.each(["8", "0", "-1"])(
    "AC-3 — an out-of-range acclimatisation day blocks submission", async (value) => {
    const posted = spyOnPost();
    const user = userEvent.setup();
    renderApp();
    await screen.findByLabelText("Starts at");
    await addOneAssignment(user);

    const acclimatisationDay = screen.getByLabelText("Acclimatisation Days (if applicable)");
    await user.type(acclimatisationDay, value);

    expect (acclimatisationDay).toBeInvalid();
    await user.click(screen.getByRole("button", { name: "Create Shift" }));
    expect(posted.count).toBe(0);
  });

  it("AC-4 — a cross-site 403 keeps the user in place with their work", async () => {
    server.use(
      http.get("*/api/v1/me", () =>
        HttpResponse.json({
          id: "u-1", username: "supervisor", displayName: "Supervisor",
          role: "SUPERVISOR", siteIds: ["unauthorised-worksite"],
        }),
      ),
      http.get("*/api/v1/sites", () =>
        HttpResponse.json([
          { id: "unauthorised-worksite", name: "Restricted Site", latitude: 1.30, longitude: 103.80, timezone: "Asia/Singapore" },
        ]),
      ),
    );
    const user = userEvent.setup();
    renderApp();
    await screen.findByLabelText("Starts at");
    await addOneAssignment(user);
    await user.click(screen.getByRole("button", { name: "Create Shift" }));
    expect(await screen.findByText(/do not have access/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Starts at")).toBeInTheDocument();
  });

  /**
   * SCRUM-420 / S6479. Sonar flags `key={i}` on this row list. All row fields here are
   * React-controlled (`value={row.X}`), so this assertion already passes before the fix —
   * controlled inputs re-sync from props on every render regardless of key-based DOM reuse,
   * so there is no observed value-bleed defect today. The fix (`key={row.id}`) is still the
   * correct React practice: it gives each row a stable identity that survives add/remove,
   * which is what protects this exact assertion if a future field here ever becomes
   * uncontrolled (local state, an animation library, a third-party input) — the class of bug
   * `key={i}` is generally associated with. This test locks in the current-and-future-correct
   * behavior; it is not evidence of a pre-existing bug.
   */
  it("keeps each row's data when a middle row is removed (SCRUM-420 / S6479)", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByLabelText("Starts at");

    await user.click(screen.getByRole("button", { name: "Add worker" }));
    await user.click(screen.getByRole("button", { name: "Add worker" }));
    await user.click(screen.getByRole("button", { name: "Add worker" }));

    const taskInputs = screen.getAllByLabelText("Task (optional)");
    expect(taskInputs).toHaveLength(3);
    await user.type(taskInputs[0]!, "First row task");
    await user.type(taskInputs[1]!, "Second row task");
    await user.type(taskInputs[2]!, "Third row task");

    const removeButtons = screen.getAllByRole("button", { name: "Remove worker" });
    await user.click(removeButtons[1]!); // remove the middle row

    const remainingTaskInputs = screen.getAllByLabelText("Task (optional)");
    expect(remainingTaskInputs).toHaveLength(2);
    expect(remainingTaskInputs[0]).toHaveValue("First row task");
    expect(remainingTaskInputs[1]).toHaveValue("Third row task");
  });

  it("already-selected workers are excluded from other rows' dropdowns", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByLabelText("Starts at");

    await user.click(screen.getByRole("button", { name: "Add worker" }));
    await user.selectOptions(screen.getByLabelText("Worker"), WORKER_ONE);

    await user.click(screen.getByRole("button", { name: "Add worker" }));
    const secondDropdown = screen.getAllByLabelText("Worker")[1]!;
    const options = Array.from(secondDropdown.querySelectorAll("option"))
      .map((o) => o.value)
      .filter(Boolean);
    expect(options).toContain(WORKER_TWO);
    expect(options).not.toContain(WORKER_ONE);
  });

  it("AC-6 — an empty shift submits, with the inline note", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByLabelText("Starts at");
    await setDateTime(user, "Starts at", "10 Aug 2026, 08:00");
    await setDateTime(user, "Ends at", "10 Aug 2026, 16:00");
    expect(screen.getByText(/No workers assigned/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create Shift" }));
    expect(await screen.findByText("Shift created")).toBeInTheDocument();
  });
});