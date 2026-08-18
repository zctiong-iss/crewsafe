/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http } from "msw";
import { AuthProvider } from "@/auth/AuthProvider";
import { useAuth } from "@/auth/useAuth";
import { fakeUserManager } from "@/test/fakeUserManager";
import { server } from "@/test/mocks/server";
import { expectNoA11yViolations } from "@/test/a11y";
import { HomePage } from "./HomePage";
import "@testing-library/jest-dom/vitest";

function WhenSignedIn({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  return state.status === "signed-in" ? <>{children}</> : null;
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <AuthProvider userManager={fakeUserManager({})}>
        <WhenSignedIn>
          <HomePage />
        </WhenSignedIn>
      </AuthProvider>
    </MemoryRouter>,
  );

describe("HomePage — status region semantics (SCRUM-420 / S6819)", () => {
  it("renders the loading message as an <output> status region carrying its original class", async () => {
    server.use(http.get("*/api/v1/sites", () => new Promise(() => {})));
    renderPage();

    const status = await screen.findByText("Loading your sites");
    expect(status.tagName).toBe("OUTPUT");
    expect(status).toHaveClass("home__loading");
  });

  it("has no accessibility violations once the site list has loaded", async () => {
    const { container } = renderPage();

    // Wait for the loaded state — axe should assess the real content, not the spinner.
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});
