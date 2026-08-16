/** @author Jemilin Beulah */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
    <MemoryRouter initialEntries={["/lightning"]}>
      <AuthProvider userManager={fakeUserManager({})}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

const asMultiSiteSupervisor = () =>
  server.use(
    http.get("*/api/v1/me", () =>
      HttpResponse.json({
        id: "u-1", username: "supervisor", displayName: "Supervisor",
        role: "SUPERVISOR", siteIds: ["site-1", "site-2"],
      }),
    ),
  );

describe("LightningHistory", () => {
  it("shows the site's current state and every seeded reading, newest first", async () => {
    renderApp();
    expect(await screen.findByText("Clear")).toBeInTheDocument();

    const rows = await screen.findAllByRole("row");
    // rows[0] is the header row.
    expect(within(rows[1]!).getByText("No strikes detected")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("32.50 km")).toBeInTheDocument();
  });

  it("shows an empty state when the site has no readings yet", async () => {
    asMultiSiteSupervisor();
    const user = userEvent.setup();
    renderApp();

    await screen.findByText("Clear");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Site" }), "site-2");

    expect(await screen.findByText("No lightning readings yet")).toBeInTheDocument();
  });

  it("shows an error state when the history fails to load", async () => {
    server.use(
      http.get("*/api/v1/sites/:siteId/lightning/observations", () =>
        HttpResponse.json({}, { status: 500 }),
      ),
    );
    renderApp();
    expect(await screen.findByText("Could not load lightning data")).toBeInTheDocument();
  });

  it("does not show a site switcher for a single-site user", async () => {
    renderApp();
    await screen.findByText("Clear");
    expect(screen.queryByRole("combobox", { name: "Site" })).not.toBeInTheDocument();
  });
});
