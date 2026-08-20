/** @author Jemilin Beulah, Tang Chee Seng */

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "@/api/identity";
import { AuthProvider } from "@/auth/AuthProvider";
import { fakeUserManager } from "@/test/fakeUserManager";
import { App } from "./App";

const OPERATIONAL_ROLES: Role[] = ["SUPERVISOR", "SAFETY_MANAGER"];

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

  it.each(OPERATIONAL_ROLES)("allows %s to open conditions", async (role) => {
    renderAt("/conditions", role);
    expect(await screen.findByRole("heading", { name: "Conditions" })).toBeInTheDocument();
  });

  it.each(OPERATIONAL_ROLES)("allows %s to open action monitoring", async (role) => {
    renderAt("/monitoring", role);
    expect(await screen.findByRole("heading", { name: "Team Monitor" })).toBeInTheDocument();
  });

  it("redirects a worker away from action monitoring", async () => {
    renderAt("/monitoring", "WORKER");
    expect(await screen.findByRole("heading", { name: "Live Board" })).toBeInTheDocument();
  });

  it.each(OPERATIONAL_ROLES)("allows %s to open shift creation", async (role) => {
    renderAt("/shifts/new", role);
    expect(await screen.findByRole("heading", { name: "Create Shift" })).toBeInTheDocument();
  });

  it.each(["SUPERVISOR", "SAFETY_MANAGER"] as Role[])(
    "keeps the approvals placeholder available to %s",
    async (role) => {
      renderAt("/approvals", role);
      expect(await screen.findByRole("heading", { name: "Action Plan Management" })).toBeInTheDocument();
    },
  );

  it.each(OPERATIONAL_ROLES)("allows %s to open the heat policy catalogue", async (role) => {
    renderAt("/policy", role);
    expect(await screen.findByRole("heading", { name: "Heat Policy" })).toBeInTheDocument();
  });

  it("redirects a worker away from the heat policy catalogue", async () => {
    renderAt("/policy", "WORKER");
    expect(await screen.findByRole("heading", { name: "Live Board" })).toBeInTheDocument();
  });

  it("allows a safety manager to open policy version creation", async () => {
    renderAt("/policy/new", "SAFETY_MANAGER");
    expect(await screen.findByRole("heading", { name: "Create Policy Version" })).toBeInTheDocument();
  });

  it("redirects a supervisor away from policy version creation", async () => {
    renderAt("/policy/new", "SUPERVISOR");
    expect(await screen.findByRole("heading", { name: "Live Board" })).toBeInTheDocument();
  });

  it.each(["/", "/conditions", "/monitoring", "/shifts/new", "/approvals", "/policy", "/policy/new"])(
    "sends an administrator at %s to the admin console, not the live board",
    async (path) => {
      renderAt(path, "ADMIN");
      expect(await screen.findByRole("heading", { name: "Admin — Sites" })).toBeInTheDocument();
    },
  );

  it.each(["WORKER", "SUPERVISOR", "SAFETY_MANAGER"] as Role[])(
    "redirects %s away from the admin console",
    async (role) => {
      renderAt("/settings", role);
      expect(await screen.findByRole("heading", { name: "Live Board" })).toBeInTheDocument();
    },
  );
});
