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

async function addOneAssignment(user: ReturnType<typeof userEvent.setup>) {
  await setDateTime(user, "Starts at", "10 Aug 2026, 08:00");
  await setDateTime(user, "Ends at", "10 Aug 2026, 16:00");
  await user.click(screen.getByRole("button", { name: "Add worker" }));
  await user.selectOptions(screen.getByLabelText("Worker"), WORKER_ONE);
  await user.click(screen.getByRole("radio", { name: "Moderate" }));
}

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
    await screen.findByLabelText("Starts at");
    await addOneAssignment(user);
    await user.click(screen.getByRole("button", { name: "Create Shift" }));
    expect(await screen.findByText("Shift created")).toBeInTheDocument();
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

  expect(await screen.findByText(/No workers are assigned/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add worker" })).toBeNull();
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

    const acclimatisationDay = screen.getByLabelText("Acclimatisation day (optional)");
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