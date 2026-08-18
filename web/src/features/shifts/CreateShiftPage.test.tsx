/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http } from "msw";
import { AuthProvider } from "@/auth/AuthProvider";
import { useAuth } from "@/auth/useAuth";
import { fakeUserManager } from "@/test/fakeUserManager";
import { server } from "@/test/mocks/server";
import { SiteProvider } from "@/site/SiteProvider";
import { expectNoA11yViolations } from "@/test/a11y";
import { CreateShiftPage } from "./CreateShiftPage";
import "@testing-library/jest-dom/vitest";

function WhenSignedIn({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  return state.status === "signed-in" ? <>{children}</> : null;
}

// SiteProvider sits inside the signed-in gate, exactly as App.tsx mounts it — CreateShiftForm
// reads useSelectedSite(), so the form cannot render without it.
const renderPage = () =>
  render(
    <MemoryRouter>
      <AuthProvider userManager={fakeUserManager({})}>
        <WhenSignedIn>
          <SiteProvider>
            <CreateShiftPage />
          </SiteProvider>
        </WhenSignedIn>
      </AuthProvider>
    </MemoryRouter>,
  );

describe("CreateShiftPage — status region semantics (SCRUM-420 / S6819)", () => {
  it("renders the loading-worksites message as an <output> status region", async () => {
    server.use(http.get("*/api/v1/sites", () => new Promise(() => {})));
    renderPage();

    const status = await screen.findByText("Loading worksites…");
    expect(status.tagName).toBe("OUTPUT");
  });

  it("has no accessibility violations once the form has loaded", async () => {
    const { container } = renderPage();

    // The form — labels tied to inputs, required fields — is the a11y-critical surface here.
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});
