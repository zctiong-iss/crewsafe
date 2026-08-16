/** @author Jemilin Beulah */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { AuthProvider } from "@/auth/AuthProvider";
import { fakeUserManager } from "@/test/fakeUserManager";
import { server } from "@/test/mocks/server";
import { App } from "@/app/App";
import "@testing-library/jest-dom/vitest";

const renderApp = (siteIds: string[] = ["site-1"]) => {
  server.use(
    http.get("*/api/v1/me", () =>
      HttpResponse.json({
        id: "u-1", username: "safety-manager", displayName: "Safety Manager",
        role: "SAFETY_MANAGER", siteIds,
      }),
    ),
  );
  return render(
    <MemoryRouter initialEntries={["/policy/new"]}>
      <AuthProvider userManager={fakeUserManager({})}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
};

const thresholdInput = (level: string, intensity: string) =>
  within(screen.getByRole("group", { name: level })).getByLabelText(intensity);

async function fillVersionDetails(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.type(screen.getByLabelText("Version label"), label);
  await user.type(screen.getByLabelText("Source"), "MOM Heat Stress Advisory, revised 2026");
  fireEvent.change(screen.getByLabelText("Effective date"), { target: { value: "2026-10-01" } });
}

describe("CreatePolicyVersionForm", () => {
  it("pre-fills every threshold and the emergency stop from the site's active version", async () => {
    renderApp();
    await screen.findByLabelText("Version label");

    expect(thresholdInput("Unacclimatised", "Light")).toHaveValue(25);
    expect(thresholdInput("Unacclimatised", "Moderate")).toHaveValue(24);
    expect(thresholdInput("Unacclimatised", "Heavy")).toHaveValue(23);
    expect(thresholdInput("Partially acclimatised", "Light")).toHaveValue(26);
    expect(thresholdInput("Fully acclimatised", "Heavy")).toHaveValue(26);
    expect(screen.getByLabelText("WBGT emergency stop (°C)")).toHaveValue(33);

    // Label, source and effective date are never pre-filled — a real revision is a tweak to
    // the numbers, and reusing the previous label would collide with the uniqueness constraint.
    expect(screen.getByLabelText("Version label")).toHaveValue("");
  });

  it("leaves thresholds blank when the site has no active version yet", async () => {
    server.use(
      http.get("*/api/v1/sites/:siteId/policy-versions/active", () =>
        HttpResponse.json({ error: "Not Found", message: "none", requestId: "r-1" }, { status: 404 }),
      ),
    );
    renderApp();
    await screen.findByLabelText("Version label");

    expect(thresholdInput("Unacclimatised", "Light")).toHaveValue(null);
    expect(screen.getByText(/this one becomes active immediately once created/)).toBeInTheDocument();
  });

  it("AC — creates a version on the happy path, saved as a draft", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByLabelText("Version label");
    await fillVersionDetails(user, "MOM-WBGT-2026.4");
    await user.click(screen.getByRole("button", { name: "Create Version" }));

    expect(await screen.findByText("Policy version created")).toBeInTheDocument();
    expect(screen.getByText(/MOM-WBGT-2026.4 was saved as a draft/)).toBeInTheDocument();
  });

  it("AC — blocks submission with no effective date", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByLabelText("Version label");
    await user.type(screen.getByLabelText("Version label"), "MOM-WBGT-2026.4");
    await user.type(screen.getByLabelText("Source"), "MOM Heat Stress Advisory");
    await user.click(screen.getByRole("button", { name: "Create Version" }));

    expect(await screen.findByText("Enter an effective date.")).toBeInTheDocument();
    expect(screen.queryByText("Policy version created")).not.toBeInTheDocument();
  });

  it("AC — blocks submission when a threshold breaks light ≥ moderate ordering", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByLabelText("Version label");

    const moderate = thresholdInput("Unacclimatised", "Moderate");
    await user.clear(moderate);
    await user.type(moderate, "26"); // light is pre-filled at 25

    await fillVersionDetails(user, "MOM-WBGT-2026.4");
    await user.click(screen.getByRole("button", { name: "Create Version" }));

    expect(await screen.findByText("Moderate threshold cannot be higher than light.")).toBeInTheDocument();
    expect(screen.queryByText("Policy version created")).not.toBeInTheDocument();
  });

  it("AC — blocks submission when a threshold is below the 15°C floor", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByLabelText("Version label");

    const heavy = thresholdInput("Fully acclimatised", "Heavy");
    await user.clear(heavy);
    await user.type(heavy, "10");

    await fillVersionDetails(user, "MOM-WBGT-2026.4");
    await user.click(screen.getByRole("button", { name: "Create Version" }));

    expect(await screen.findByText("Must be at least 15°C.")).toBeInTheDocument();
  });

  it("lets a multi-site user switch sites and re-pre-fills from that site's active version", async () => {
    const user = userEvent.setup();
    renderApp(["site-1", "site-2"]);
    await screen.findByLabelText("Version label");
    expect(screen.getByLabelText("WBGT emergency stop (°C)")).toHaveValue(33);

    await user.selectOptions(screen.getByRole("combobox", { name: "Site" }), "site-2");

    await screen.findByLabelText("Version label");
    expect(screen.getByLabelText("WBGT emergency stop (°C)")).toHaveValue(32);
  });
});
