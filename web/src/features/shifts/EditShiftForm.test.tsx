/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { AuthProvider } from "@/auth/AuthProvider";
import { fakeUserManager } from "@/test/fakeUserManager";
import { server } from "@/test/mocks/server";
import { App } from "@/app/App";
import type { Shift } from "@/api/shifts";
import "@testing-library/jest-dom/vitest";

const SHIFT: Shift = {
  id: "shift-1", siteId: "site-1",
  startsAt: "2026-08-20T00:00:00Z", endsAt: "2026-08-20T08:00:00Z",
  status: "PLANNED", assignments: [],
};
const SHIFT_PATH = "*/api/v1/sites/:siteId/shifts/:shiftId";
const WORKERS_PATH = "*/api/v1/sites/:siteId/workers";

const renderEdit = (shift: Shift = SHIFT) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: `/shifts/${shift.id}/edit`, state: { shift } }]}>
      <AuthProvider userManager={fakeUserManager({})}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

// ShiftRoster fetches workers on mount — default so an unhandled GET can't error a test.
// Roster-specific tests override this with a populated list (added later = matched first).
beforeEach(() => {
  server.use(http.get(WORKERS_PATH, () => HttpResponse.json([])));
});

describe("EditShiftForm", () => {
  it("saves corrected times and confirms", async () => {
    // Capture what actually reaches the server, so we can prove the EDITED time travels —
    // not merely that the save→confirm round-trip renders.
    let sent: { startsAt?: string; endsAt?: string } | undefined;
    server.use(
      http.patch(SHIFT_PATH, async ({ request }) => {
        sent = (await request.json()) as typeof sent;
        return HttpResponse.json({ ...SHIFT, status: "PLANNED" });
      }),
    );
    const user = userEvent.setup();
    renderEdit();

    // Correct BOTH times before saving. "Starts at"/"Ends at" are react-datepicker text inputs
    // formatted as "d MMM yyyy, HH:mm" (see ShiftTimeFields.tsx). Both move to the 21st keeping
    // start < end so validateShift accepts them; 09:00/17:00 stay well clear of midnight so the
    // resulting UTC date holds regardless of the runner's timezone.
    const start = await screen.findByLabelText("Starts at"); // findBy waits for auth to resolve + form to mount
    await user.clear(start);
    await user.type(start, "21 Aug 2026, 09:00");
    const end = screen.getByLabelText("Ends at");
    await user.clear(end);
    await user.type(end, "21 Aug 2026, 17:00");

    await user.click(await screen.findByRole("button", { name: "Update Shift Schedule" }));
    expect(await screen.findByText("Shift updated")).toBeInTheDocument();

    // The payload carried the NEW date, and it is no longer the seeded value — this is what
    // makes the test earn its name.
    expect(sent?.startsAt).toContain("2026-08-21");
    expect(sent?.startsAt).not.toBe(SHIFT.startsAt);
  });

  it("adds a worker to the roster", async () => {
    server.use(
      http.get(WORKERS_PATH, () => HttpResponse.json([{ id: "w-1", displayName: "Aisha" }])),
      http.post(`${SHIFT_PATH}/assignments`, () =>
        HttpResponse.json({ ...SHIFT, assignments: [{ id: "a-1", workerId: "w-1", intensity: "MODERATE" }] })),
    );
    const user = userEvent.setup();
    renderEdit();
    // The Add-worker picker is hidden until you click the toggle (matches the Create-shift page).
    await user.click(await screen.findByRole("button", { name: "Add Worker" }));
    await user.selectOptions(screen.getByLabelText("Worker"), "w-1");
    await user.click(screen.getByRole("button", { name: "Add" }));
    // A Remove button only renders for an assigned row — proof the roster now holds the worker.
    expect(await screen.findByRole("button", { name: "Remove This Worker" })).toBeInTheDocument();
  });

  it("hides an already-assigned worker from the Add-worker list (no double-add)", async () => {
    // Aisha (w-1) is already on the shift; Ben (w-2) is not.
    const staffed: Shift = { ...SHIFT, assignments: [{ id: "a-1", workerId: "w-1", intensity: "MODERATE" }] };
    server.use(
      http.get(WORKERS_PATH, () =>
        HttpResponse.json([{ id: "w-1", displayName: "Aisha" }, { id: "w-2", displayName: "Ben" }])),
    );
    const user = userEvent.setup();
    renderEdit(staffed);
    await user.click(await screen.findByRole("button", { name: "Add Worker" }));
    // Scope to the picker so we match its <option>s, not Aisha's name in the roster row above.
    const picker = within(screen.getByLabelText("Worker"));
    expect(picker.queryByRole("option", { name: "Aisha" })).not.toBeInTheDocument(); // already assigned — filtered out
    expect(picker.getByRole("option", { name: "Ben" })).toBeInTheDocument();          // unassigned — still available
  });

  it("removes a worker from the roster", async () => {
    const staffed: Shift = { ...SHIFT, assignments: [{ id: "a-1", workerId: "w-1", intensity: "MODERATE" }] };
    server.use(
      http.get(WORKERS_PATH, () => HttpResponse.json([{ id: "w-1", displayName: "Aisha" }])),
      http.delete(`${SHIFT_PATH}/assignments/:assignmentId`, () => new HttpResponse(null, { status: 204 })),
    );
    const user = userEvent.setup();
    renderEdit(staffed);
    await user.click(await screen.findByRole("button", { name: "Remove This Worker" }));
    expect(await screen.findByText("No workers assigned yet.")).toBeInTheDocument();
  });

  it("edits a row and PATCHes the full trio (task + intensity + accl), never a partial that wipes", async () => {
    const staffed: Shift = {
      ...SHIFT,
      assignments: [{ id: "a-1", workerId: "w-1", intensity: "MODERATE", taskName: "Grass cutting", acclimatisationDay: 3 }],
    };
    let sent: unknown;
    server.use(
      http.get(WORKERS_PATH, () => HttpResponse.json([{ id: "w-1", displayName: "Aisha" }])),
      http.patch(`${SHIFT_PATH}/assignments/:assignmentId`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ...staffed, assignments: [{ ...staffed.assignments[0], taskName: "Tree pruning" }] });
      }),
    );
    const user = userEvent.setup();
    renderEdit(staffed);
    await user.click(await screen.findByRole("button", { name: "Edit Worker's Details" }));
    const task = screen.getByLabelText("Task (optional)");
    await user.clear(task);
    await user.type(task, "Tree pruning");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/tree pruning/i);
    // The whole trio travels — changing the task did NOT drop intensity or acclimatisation day.
    expect(sent).toEqual({ intensity: "MODERATE", taskName: "Tree pruning", acclimatisationDay: 3 });
  });

  it("keeps Confirm cancel disabled until a reason is entered", async () => {
    const user = userEvent.setup();
    renderEdit();
    await user.click(await screen.findByRole("button", { name: "Cancel Shift" }));
    expect(screen.getByRole("button", { name: "Confirm Shift Cancellation" })).toBeDisabled();
    await user.type(screen.getByLabelText(/reason for cancelling/i), "Bad weather");
    expect(screen.getByRole("button", { name: "Confirm Shift Cancellation" })).toBeEnabled();
  });

  it("cancels with a reason and shows the terminal state", async () => {
    server.use(http.post(`${SHIFT_PATH}/cancel`, () => HttpResponse.json({ ...SHIFT, status: "CANCELLED" })));
    const user = userEvent.setup();
    renderEdit();
    await user.click(await screen.findByRole("button", { name: "Cancel Shift" }));
    await user.type(screen.getByLabelText(/reason for cancelling/i), "Bad weather — site closed");
    await user.click(screen.getByRole("button", { name: "Confirm Shift Cancellation" }));
    expect(await screen.findByText("Shift cancelled")).toBeInTheDocument();
  });

  it("keeps the user signed in and explains when the server refuses the cancel (400)", async () => {
    server.use(
      http.post(`${SHIFT_PATH}/cancel`, () =>
        HttpResponse.json({ error: "BadRequest", message: "Already closed", requestId: "r-1" }, { status: 400 })),
    );
    const user = userEvent.setup();
    renderEdit();
    await user.click(await screen.findByRole("button", { name: "Cancel Shift" }));
    await user.type(screen.getByLabelText(/reason for cancelling/i), "Bad weather");
    await user.click(screen.getByRole("button", { name: "Confirm Shift Cancellation" }));
    expect(await screen.findByText(/was not valid/i)).toBeInTheDocument();
  });

  it("hides the cancel action for a CLOSED shift", async () => {
    renderEdit({ ...SHIFT, status: "CLOSED" });
    expect(await screen.findByText(/can no longer be cancelled/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel shift…" })).not.toBeInTheDocument();
  });
});