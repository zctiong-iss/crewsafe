/** @author Jemilin Beulah */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { AuthProvider } from "@/auth/AuthProvider";
import { useAuth } from "@/auth/useAuth";
import { fakeUserManager } from "@/test/fakeUserManager";
import { server } from "@/test/mocks/server";
import { SiteProvider } from "@/site/SiteProvider";
import { expectNoA11yViolations } from "@/test/a11y";
import type { ConditionsStreamHandlers } from "@/api/conditionsStream";
import { ConditionsPage } from "./ConditionsPage";
import "@testing-library/jest-dom/vitest";

function WhenSignedIn({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  return state.status === "signed-in" ? <>{children}</> : null;
}

// SiteProvider reads useCurrentUser(), so it must sit inside the signed-in gate, exactly as
// it does in App.tsx (mounted only inside the "signed-in" switch case).
const renderPage = () => {
  const fakeSubscribe = (_siteId: string, handlers: ConditionsStreamHandlers) => {
    handlers.onStatus("connecting");
    return () => {};
  };
  return render(
    <MemoryRouter>
      <AuthProvider userManager={fakeUserManager({})}>
        <WhenSignedIn>
          <SiteProvider>
            <ConditionsPage subscribe={fakeSubscribe} />
          </SiteProvider>
        </WhenSignedIn>
      </AuthProvider>
    </MemoryRouter>,
  );
};

const asMultiSite = () =>
  server.use(
    http.get("*/api/v1/me", () =>
      HttpResponse.json({
        id: "u-1", username: "supervisor", displayName: "Supervisor",
        role: "SUPERVISOR", siteIds: ["site-1", "site-2"],
      }),
    ),
  );

const asNoSite = () =>
  server.use(
    http.get("*/api/v1/me", () =>
      HttpResponse.json({
        id: "u-1", username: "unassigned", displayName: "Unassigned",
        role: "WORKER", siteIds: [],
      }),
    ),
  );

describe("ConditionsPage", () => {
  it("shows an empty state when the user has no site assigned", async () => {
    asNoSite();
    renderPage();
    expect(await screen.findByText("No site assigned")).toBeInTheDocument();
  });

  it("shows no site switcher for a single-site user", async () => {
    renderPage();
    await screen.findByText("Conditions");
    expect(screen.queryByRole("combobox", { name: "Site" })).not.toBeInTheDocument();
  });

  it("lets a multi-site user switch which site's conditions are shown", async () => {
    asMultiSite();
    const user = userEvent.setup();
    renderPage();

    const picker = await screen.findByRole("combobox", { name: "Site" });
    expect(screen.getByRole("option", { name: "Bishan Park Landscaping" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "NUS Campus Maintenance" })).toBeInTheDocument();
    expect(picker).toHaveValue("site-1");

    await user.selectOptions(picker, "site-2");
    expect(picker).toHaveValue("site-2");
  });

  it("has no accessibility violations", async () => {
    const { container } = renderPage();

    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});
