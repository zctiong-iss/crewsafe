/** @author Tang Chee Seng (with assistance from Claude and ChatGPT) */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app/App";
import { fakeUserManager } from "@/test/fakeUserManager";
import { AuthProvider } from "./AuthProvider";
import { IDLE_TIMEOUT_MS } from "./sessionPolicy";

const currentUserResponse = () => new Response(JSON.stringify({
  id: "u-1", username: "worker1", displayName: "Worker", role: "WORKER", siteIds: [],
}), { status: 200, headers: { "Content-Type": "application/json" } });

async function renderSignedIn(manager = fakeUserManager({})) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(currentUserResponse()));
  const redirectTo = vi.fn();
  render(
    <MemoryRouter>
      <AuthProvider userManager={manager} redirectTo={redirectTo}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Live Board" });
  return { redirectTo, manager };
}

describe("session termination", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ["invalid", Number.NaN],
    ["implausibly future", (Date.UTC(2026, 7, 11, 0, 6, 0)) / 1_000],
  ])("fails closed for %s auth_time", async (_description, authTime) => {
    const now = Date.UTC(2026, 7, 11, 0, 0, 0);
    const manager = fakeUserManager({ authTime });
    const revoke = vi.spyOn(manager, "revokeTokens");
    const redirectTo = vi.fn();

    render(
      <MemoryRouter>
        <AuthProvider userManager={manager} redirectTo={redirectTo} now={() => now}>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(revoke).toHaveBeenCalledWith(["refresh_token"]);
    expect(redirectTo).toHaveBeenCalledTimes(1);
  });

  it("revokes the refresh token before local cleanup", async () => {
    const { manager, redirectTo } = await renderSignedIn();
    const revoke = vi.spyOn(manager, "revokeTokens");
    const remove = vi.spyOn(manager, "removeUser");
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(revoke).toHaveBeenCalledWith(["refresh_token"]);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(revoke.mock.invocationCallOrder[0]!).toBeLessThan(remove.mock.invocationCallOrder[0]!);
    expect(redirectTo).toHaveBeenCalledTimes(1);
  });

  it("still clears and redirects when revocation rejects", async () => {
    const manager = fakeUserManager({});
    vi.spyOn(manager, "revokeTokens").mockRejectedValue(new Error("revocation unavailable"));
    const remove = vi.spyOn(manager, "removeUser");
    const result = await renderSignedIn(manager);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(result.redirectTo).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("still resets state and redirects when local removal rejects", async () => {
    const manager = fakeUserManager({});
    vi.spyOn(manager, "removeUser").mockRejectedValue(new Error("storage unavailable"));
    const result = await renderSignedIn(manager);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(result.redirectTo).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("keeps idle expiry active while a valid token is not provisioned", async () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 7, 11, 0, 0, 0);
    vi.setSystemTime(start);
    const manager = fakeUserManager({ authTime: start / 1_000 });
    const revoke = vi.spyOn(manager, "revokeTokens");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    )));

    render(
      <MemoryRouter>
        <AuthProvider userManager={manager} redirectTo={vi.fn()}>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole("heading", { name: "Account not set up yet" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 1);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(revoke).toHaveBeenCalledWith(["refresh_token"]);
  });

  it("keeps idle expiry active while the backend identity lookup has failed", async () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 7, 11, 0, 0, 0);
    vi.setSystemTime(start);
    const manager = fakeUserManager({ authTime: start / 1_000 });
    const revoke = vi.spyOn(manager, "revokeTokens");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )));

    render(
      <MemoryRouter>
        <AuthProvider userManager={manager} redirectTo={vi.fn()}>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 1);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(revoke).toHaveBeenCalledWith(["refresh_token"]);
  });
});
