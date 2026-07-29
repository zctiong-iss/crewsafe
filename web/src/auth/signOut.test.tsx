/**
 * @author Jemilin Beulah
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "./AuthProvider";
import { App } from "@/app/App";
import { cognitoSignOutUrl } from "./authConfig";
import { fakeUserManager } from "@/test/fakeUserManager";

/**
 * Signing out must end both sessions: this app's tokens, and Cognito's own SSO cookie.
 *
 * Clearing only the local tokens — what `manager.removeUser()` alone does — leaves Cognito
 * signed in. The next "Sign in" click on the same browser then re-authenticates silently,
 * no password prompt, regardless of who is now at the machine. On a shared site-office
 * console this is the exact scenario ADR 0005 was written around.
 */
describe("sign out", () => {
  it("builds Cognito's own logout URL, not the generic OIDC one", () => {
    const url = new URL(cognitoSignOutUrl());

    // The Hosted UI domain (VITE_COGNITO_HOSTED_UI_DOMAIN), not the issuer
    // (VITE_COGNITO_AUTHORITY) — the two are different hosts.
    expect(url.origin).toBe("https://test-domain.auth.test.amazoncognito.com");
    expect(url.pathname).toBe("/logout");

    // Cognito's own param names, not the standard end_session_endpoint ones
    // (post_logout_redirect_uri, id_token_hint) that Cognito silently ignores.
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("logout_uri")).toBe("http://localhost:5173/");
    expect(url.searchParams.has("post_logout_redirect_uri")).toBe(false);
  });

  it("clears the local session and navigates to Cognito's logout endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ id: "u-1", username: "worker1", displayName: "Worker", role: "WORKER", siteIds: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const redirectTo = vi.fn();

    render(
      <MemoryRouter>
        <AuthProvider userManager={fakeUserManager({})} redirectTo={redirectTo}>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Live board" });

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    // The app itself reflects signed-out immediately...
    expect(await screen.findByRole("heading", { name: "Sign in to CrewSafe" })).toBeInTheDocument();
    // ...and the browser is also sent to end the Cognito-side session, not left there.
    expect(redirectTo).toHaveBeenCalledTimes(1);
    expect(redirectTo.mock.calls[0]![0]).toContain("/logout");
  });
});
