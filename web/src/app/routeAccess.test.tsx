/** @author Tang Chee Seng (with assistance from Claude and ChatGPT) */

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "@/api/identity";
import { AuthProvider } from "@/auth/AuthProvider";
import { fakeUserManager } from "@/test/fakeUserManager";
import { App } from "./App";

const ROLES: Role[] = ["WORKER", "SUPERVISOR", "SAFETY_MANAGER", "ADMIN"];

function renderAt(path: string, role: Role) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const body = String(input).endsWith("/api/v1/me")
      ? { id: "u-1", username: "test", displayName: "Test User", role, siteIds: [] }
      : [];
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  }));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider userManager={fakeUserManager({})}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("direct route access", () => {
  it.each(["/conditions", "/shifts/new"])("redirects a worker away from %s", async (path) => {
    renderAt(path, "WORKER");
    expect(await screen.findByRole("heading", { name: "Live Board" })).toBeInTheDocument();
  });

  it.each(ROLES.slice(1))("allows %s to open conditions", async (role) => {
    renderAt("/conditions", role);
    expect(await screen.findByRole("heading", { name: "Conditions" })).toBeInTheDocument();
  });

  it.each(ROLES.slice(1))("allows %s to open shift creation", async (role) => {
    renderAt("/shifts/new", role);
    expect(await screen.findByRole("heading", { name: "Create Shift" })).toBeInTheDocument();
  });

  it.each(["SUPERVISOR", "SAFETY_MANAGER"] as Role[])(
    "keeps the approvals placeholder available to %s",
    async (role) => {
      renderAt("/approvals", role);
      expect(await screen.findByRole("heading", { name: "Approvals" })).toBeInTheDocument();
    },
  );

  it("redirects an administrator away from approvals", async () => {
    renderAt("/approvals", "ADMIN");
    expect(await screen.findByRole("heading", { name: "Live Board" })).toBeInTheDocument();
  });
});
