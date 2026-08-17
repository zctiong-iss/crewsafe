/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http } from "msw";
import { AuthProvider } from "@/auth/AuthProvider";
import { useAuth } from "@/auth/useAuth";
import { fakeUserManager } from "@/test/fakeUserManager";
import { server } from "@/test/mocks/server";
import { CreateShiftPage } from "./CreateShiftPage";
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
          <CreateShiftPage />
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
});
