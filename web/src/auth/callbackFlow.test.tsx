/**
 * @author Jemilin Beulah
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { UserManager } from "oidc-client-ts";
import { AuthProvider } from "./AuthProvider";
import { App } from "@/app/App";

/**
 * Returning from Cognito must actually sign you in.
 *
 * This is a regression test for a bug that every other test missed: CallbackPage used to
 * build its *own* UserManager to exchange the code. The tokens landed in sessionStorage
 * correctly, so the exchange "worked" — but the provider that decides what to render never
 * re-read them, and the app dropped the user back on the sign-in screen holding a valid
 * session. Nothing threw, nothing logged.
 *
 * The other tests could not catch it because they render each auth state directly. Only
 * driving the transition exposes it, which is why this one starts at /callback.
 */
function managerThatSignsIn() {
  let signedIn = false;

  return {
    getUser: async () => (signedIn ? { access_token: "t", expired: false } : null),
    signinRedirect: async () => undefined,
    signinRedirectCallback: async () => {
      signedIn = true;
      return {} as never;
    },
    removeUser: async () => undefined,
    events: {
      addAccessTokenExpired: () => undefined,
      removeAccessTokenExpired: () => undefined,
      addSilentRenewError: () => undefined,
      removeSilentRenewError: () => undefined,
    },
  } as unknown as UserManager;
}

describe("returning from Cognito", () => {
  it("lands the user in the app, not back on the sign-in screen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "u-1",
            username: "supervisor1",
            displayName: "Aisyah",
            role: "SUPERVISOR",
            siteIds: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    render(
      <MemoryRouter initialEntries={["/callback?code=abc&state=xyz"]}>
        <AuthProvider userManager={managerThatSignsIn()}>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Live board" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("explains a stale or reused sign-in link instead of hanging", async () => {
    const manager = {
      getUser: async () => null,
      signinRedirect: async () => undefined,
      signinRedirectCallback: async () => {
        throw new Error("code already redeemed");
      },
      removeUser: async () => undefined,
      events: {
        addAccessTokenExpired: () => undefined,
        removeAccessTokenExpired: () => undefined,
        addSilentRenewError: () => undefined,
        removeSilentRenewError: () => undefined,
      },
    } as unknown as UserManager;

    vi.stubGlobal("fetch", vi.fn());

    render(
      <MemoryRouter initialEntries={["/callback?code=used&state=xyz"]}>
        <AuthProvider userManager={manager}>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Sign-in did not complete" }),
    ).toBeInTheDocument();
  });
});
