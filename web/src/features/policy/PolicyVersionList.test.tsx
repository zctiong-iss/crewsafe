/** @author Jemilin Beulah */
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
    <MemoryRouter initialEntries={["/policy"]}>
      <AuthProvider userManager={fakeUserManager({})}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

const asSafetyManager = () =>
  server.use(
    http.get("*/api/v1/me", () =>
      HttpResponse.json({
        id: "u-1", username: "safety-manager", displayName: "Safety Manager",
        role: "SAFETY_MANAGER", siteIds: ["site-1"],
      }),
    ),
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

describe("PolicyVersionList", () => {
  it("renders every seeded version with its status", async () => {
    renderApp();
    expect(await screen.findByText("MOM-WBGT-2026.2")).toBeInTheDocument();
    expect(screen.getByText("MOM-WBGT-2026.3")).toBeInTheDocument();
    expect(screen.getByText("MOM-WBGT-2026.1")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Superseded")).toBeInTheDocument();
  });

  it("opens the active version's thresholds by default", async () => {
    renderApp();
    await screen.findByText("MOM-WBGT-2026.2");
    expect(screen.getByRole("button", { name: "Hide thresholds" })).toBeInTheDocument();
  });

  it("expands a closed card to show its thresholds", async () => {
    const user = userEvent.setup();
    renderApp();
    const [firstClosed] = await screen.findAllByRole("button", { name: "Show thresholds" });
    expect(firstClosed).toHaveAttribute("aria-expanded", "false");
    await user.click(firstClosed!);
    expect(firstClosed).toHaveAttribute("aria-expanded", "true");
  });

  it("hides create and activate controls from a supervisor", async () => {
    renderApp();
    await screen.findByText("MOM-WBGT-2026.2");
    expect(screen.queryByRole("link", { name: "Create New Version" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate this version" })).not.toBeInTheDocument();
  });

  it("offers create and activate controls to a safety manager, only on the draft", async () => {
    asSafetyManager();
    renderApp();
    await screen.findByText("MOM-WBGT-2026.2");
    expect(screen.getByRole("link", { name: "Create New Version" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Activate this version" })).toHaveLength(1);
  });

  it("names the version being superseded before activating, and lets a safety manager back out", async () => {
    asSafetyManager();
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "Activate this version" }));
    expect(screen.getByText(/Activate/)).toBeInTheDocument();
    expect(screen.getByText("MOM-WBGT-2026.3", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("MOM-WBGT-2026.2", { selector: "strong" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Confirm activation" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate this version" })).toBeInTheDocument();
  });

  it("reflects the new ACTIVE and previous SUPERSEDED after confirming, without a manual refresh", async () => {
    asSafetyManager();
    let activated = false;
    server.use(
      http.get("*/api/v1/sites/:siteId/policy-versions", () =>
        HttpResponse.json(
          activated
            ? [
                { id: "v-active", versionLabel: "MOM-WBGT-2026.3", status: "ACTIVE", source: "s", effectiveDate: "2026-09-01",
                  wbgtThresholdUnacclimatisedLight: 25, wbgtThresholdUnacclimatisedModerate: 24, wbgtThresholdUnacclimatisedHeavy: 23,
                  wbgtThresholdPartialLight: 26, wbgtThresholdPartialModerate: 25, wbgtThresholdPartialHeavy: 24,
                  wbgtThresholdFullLight: 28, wbgtThresholdFullModerate: 27, wbgtThresholdFullHeavy: 26,
                  wbgtEmergencyStop: 33, notes: null, createdBy: "u-1", siteId: "site-1",
                  createdAt: "2026-08-10T00:00:00Z", updatedAt: "2026-08-13T00:00:00Z", activatedAt: "2026-08-13T00:00:00Z", supersededAt: null },
                { id: "v-superseded", versionLabel: "MOM-WBGT-2026.2", status: "SUPERSEDED", source: "s", effectiveDate: "2026-07-01",
                  wbgtThresholdUnacclimatisedLight: 25, wbgtThresholdUnacclimatisedModerate: 24, wbgtThresholdUnacclimatisedHeavy: 23,
                  wbgtThresholdPartialLight: 26, wbgtThresholdPartialModerate: 25, wbgtThresholdPartialHeavy: 24,
                  wbgtThresholdFullLight: 28, wbgtThresholdFullModerate: 27, wbgtThresholdFullHeavy: 26,
                  wbgtEmergencyStop: 33, notes: null, createdBy: "u-1", siteId: "site-1",
                  createdAt: "2026-06-20T00:00:00Z", updatedAt: "2026-08-13T00:00:00Z", activatedAt: "2026-07-01T00:00:00Z", supersededAt: "2026-08-13T00:00:00Z" },
              ]
            : [
                { id: "v-active", versionLabel: "MOM-WBGT-2026.2", status: "ACTIVE", source: "s", effectiveDate: "2026-07-01",
                  wbgtThresholdUnacclimatisedLight: 25, wbgtThresholdUnacclimatisedModerate: 24, wbgtThresholdUnacclimatisedHeavy: 23,
                  wbgtThresholdPartialLight: 26, wbgtThresholdPartialModerate: 25, wbgtThresholdPartialHeavy: 24,
                  wbgtThresholdFullLight: 28, wbgtThresholdFullModerate: 27, wbgtThresholdFullHeavy: 26,
                  wbgtEmergencyStop: 33, notes: null, createdBy: "u-1", siteId: "site-1",
                  createdAt: "2026-06-20T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z", activatedAt: "2026-07-01T00:00:00Z", supersededAt: null },
                { id: "v-draft", versionLabel: "MOM-WBGT-2026.3", status: "DRAFT", source: "s", effectiveDate: "2026-09-01",
                  wbgtThresholdUnacclimatisedLight: 25, wbgtThresholdUnacclimatisedModerate: 24, wbgtThresholdUnacclimatisedHeavy: 23,
                  wbgtThresholdPartialLight: 26, wbgtThresholdPartialModerate: 25, wbgtThresholdPartialHeavy: 24,
                  wbgtThresholdFullLight: 28, wbgtThresholdFullModerate: 27, wbgtThresholdFullHeavy: 26,
                  wbgtEmergencyStop: 33, notes: null, createdBy: "u-1", siteId: "site-1",
                  createdAt: "2026-08-10T00:00:00Z", updatedAt: "2026-08-10T00:00:00Z", activatedAt: null, supersededAt: null },
              ],
        ),
      ),
      http.post("*/api/v1/sites/:siteId/policy-versions/:versionId/activate", () => {
        activated = true;
        return HttpResponse.json({ id: "v-active", status: "ACTIVE" });
      }),
    );

    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "Activate this version" }));
    await user.click(screen.getByRole("button", { name: "Confirm activation" }));

    await screen.findByText("Superseded");
    const pills = screen.getAllByText(/^(Active|Superseded)$/);
    expect(pills.map((p) => p.textContent)).toEqual(expect.arrayContaining(["Active", "Superseded"]));
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });

  it("shows an empty state with a create action when the site has no versions", async () => {
    asSafetyManager();
    server.use(http.get("*/api/v1/sites/:siteId/policy-versions", () => HttpResponse.json([])));
    renderApp();
    expect(await screen.findByText("No policy versions yet")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Create New Version" }).length).toBeGreaterThan(0);
  });

  it("shows an error state when the catalogue fails to load", async () => {
    server.use(
      http.get("*/api/v1/sites/:siteId/policy-versions", () => HttpResponse.json({}, { status: 500 })),
    );
    renderApp();
    expect(await screen.findByText("Could not load policy versions")).toBeInTheDocument();
  });

  it("does not show a site switcher for a single-site user", async () => {
    renderApp();
    await screen.findByText("MOM-WBGT-2026.2");
    expect(screen.queryByRole("combobox", { name: "Site" })).not.toBeInTheDocument();
  });

  it("lets a multi-site user switch sites, loading that site's own catalogue", async () => {
    asMultiSiteSupervisor();
    const user = userEvent.setup();
    renderApp();

    await screen.findByText("MOM-WBGT-2026.2");
    const picker = await screen.findByRole("combobox", { name: "Site" });
    expect(screen.getByRole("option", { name: "Bishan Park Landscaping" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "NUS Campus Maintenance" })).toBeInTheDocument();

    await user.selectOptions(picker, "site-2");

    expect(await screen.findByText("NUS-WBGT-2026.1")).toBeInTheDocument();
    expect(screen.queryByText("MOM-WBGT-2026.2")).not.toBeInTheDocument();
  });
});
