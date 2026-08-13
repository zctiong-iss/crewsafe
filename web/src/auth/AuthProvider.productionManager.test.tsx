/** @author Tang Chee Seng (with assistance from OpenAI Codex) */

import { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./AuthProvider";
import { useAuth } from "./useAuth";

const productionManager = vi.hoisted(() => {
  const manager = {
    getUser: vi.fn(async () => ({
      access_token: "test-access-token",
      refresh_token: "test-refresh-token",
      expired: false,
      profile: { auth_time: Math.max(1, Math.floor(Date.now() / 1_000)) },
    })),
    signinRedirect: vi.fn(async () => undefined),
    signinRedirectCallback: vi.fn(async () => undefined),
    removeUser: vi.fn(async () => undefined),
    revokeTokens: vi.fn(async () => undefined),
    events: {
      addAccessTokenExpired: vi.fn(),
      removeAccessTokenExpired: vi.fn(),
      addSilentRenewError: vi.fn(),
      removeSilentRenewError: vi.fn(),
    },
  };

  return { constructorSpy: vi.fn(), manager };
});

vi.mock("oidc-client-ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("oidc-client-ts")>();

  return {
    ...original,
    UserManager: class MockUserManager {
      constructor() {
        productionManager.constructorSpy();
        return productionManager.manager;
      }
    },
  };
});

function StateProbe({ marker }: { marker: string }) {
  const { state } = useAuth();
  return <span>{`${state.status}:${marker}`}</span>;
}

const currentUserResponse = () => new Response(JSON.stringify({
  id: "u-1",
  username: "worker1",
  displayName: "Worker",
  role: "WORKER",
  siteIds: [],
}), { status: 200, headers: { "Content-Type": "application/json" } });

describe("production UserManager lifetime", () => {
  it("constructs one manager across StrictMode, provider rerenders, and activity updates", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => currentUserResponse()));
    const redirectTo = vi.fn();

    const provider = (marker: string) => (
      <StrictMode>
        <MemoryRouter>
          <AuthProvider redirectTo={redirectTo}>
            <StateProbe marker={marker} />
          </AuthProvider>
        </MemoryRouter>
      </StrictMode>
    );
    const { rerender } = render(provider("initial"));

    expect(await screen.findByText("signed-in:initial")).toBeInTheDocument();
    rerender(provider("rerendered"));
    expect(screen.getByText("signed-in:rerendered")).toBeInTheDocument();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
      await Promise.resolve();
    });

    expect(productionManager.constructorSpy).toHaveBeenCalledTimes(1);
  });
});
