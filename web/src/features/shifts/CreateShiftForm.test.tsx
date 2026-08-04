/** @author Tang Chee Seng (with assistance from Claude and ChatGPT) */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { AuthProvider } from "@/auth/AuthProvider";
import { fakeUserManager } from "@/test/fakeUserManager";
import { server } from "@/test/mocks/server";
import { App } from "@/app/App";
import "@testing-library/jest-dom/vitest";

// Render the app such that it begins at the create-shift route, and signed in as a testing supervisor.
const renderApp = () =>
  render(
    <MemoryRouter initialEntries={["/shifts/new"]}>
      <AuthProvider userManager={fakeUserManager({})}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

// Set datetime-local with a direct change event.
const setDateTime = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const WORKER_ONE = "00000000-0000-4000-8000-000000000001";

async function addOneAssignment(user: ReturnType<typeof userEvent.setup>) {
  setDateTime("Starts at", "2026-08-10T08:00");
  setDateTime("Ends at", "2026-08-10T16:00");
  await user.click(screen.getByRole("button", { name: "Add worker" }));
  await user.selectOptions(screen.getByLabelText("Worker"), WORKER_ONE);
  await user.click(screen.getByRole("radio", { name: "Moderate" }));
}

// A POST spy that records calls — lets AC-2 / AC-3 assert "no request was sent".
function spyOnPost() {
  const calls = { count: 0 };
  server.use(
    http.post("*/api/v1/sites/:siteId/shifts", () => {
      calls.count += 1;
      return HttpResponse.json({ id: "shift-1", status: "PLANNED" }, { status: 201 });
    }),
  );
  return calls;
}

describe("CreateShiftForm", () => {
  it("AC-1 — creates a shift on the happy path", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByLabelText("Starts at"); // signed-in + workers loaded
    await addOneAssignment(user);
    await user.click(screen.getByRole("button", { name: "Create shift" }));
    expect(await screen.findByText("Shift created")).toBeInTheDocument();
  });

  it("AC-2 — a reversed date order sends no request", async () => {
    const posted = spyOnPost();
    const user = userEvent.setup();
    renderApp();
    await screen.findByLabelText("Starts at");
    setDateTime("Starts at", "2026-08-10T16:00");
    setDateTime("Ends at", "2026-08-10T08:00");
    await user.click(screen.getByRole("button", { name: "Create shift" }));
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

    const acclimatisationDay = screen.getByLabelText("Acclimatisation day (optional)");
    await user.type(acclimatisationDay, value);

    expect (acclimatisationDay).toBeInvalid();
    await user.click(screen.getByRole("button", { name: "Create shift" }));
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
    );
    const user = userEvent.setup();
    renderApp();
    await screen.findByLabelText("Starts at");
    await addOneAssignment(user);
    await user.click(screen.getByRole("button", { name: "Create shift" }));
    expect(await screen.findByText(/do not have access/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Starts at")).toHaveValue("2026-08-10T08:00"); // nothing thrown away
  });

  it("AC-6 — an empty shift submits, with the inline note", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByLabelText("Starts at");
    setDateTime("Starts at", "2026-08-10T08:00");
    setDateTime("Ends at", "2026-08-10T16:00");
    expect(screen.getByText(/No workers assigned/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create shift" }));
    expect(await screen.findByText("Shift created")).toBeInTheDocument();
  });
});