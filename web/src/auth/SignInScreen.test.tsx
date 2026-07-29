/**
 * @author Jemilin Beulah
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignInScreen } from "./SignInScreen";

/**
 * A failed redirect to Cognito must be visible.
 *
 * signIn() can reject before the browser ever leaves the page — no network, a firewall
 * blocking the pool's domain, an ad-blocker. The naive `onClick={() => void signIn()}`
 * swallows that rejection: the button does nothing, and a real connectivity problem looks
 * identical to a page that just doesn't respond to clicks. Reproduced by hand with
 * Playwright against a sandbox that could not resolve Cognito's domain — the app showed
 * nothing at all.
 */
describe("SignInScreen", () => {
  it("shows an explanation when the redirect to Cognito fails", async () => {
    const onSignIn = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    render(<SignInScreen onSignIn={onSignIn} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText(/could not reach the sign-in page/i)).toBeInTheDocument();
  });

  it("lets the user try again after a failed redirect", async () => {
    const onSignIn = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(undefined);
    render(<SignInScreen onSignIn={onSignIn} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByText(/could not reach the sign-in page/i);

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(onSignIn).toHaveBeenCalledTimes(2);
  });

  it("does not show a failure message before anything has been attempted", () => {
    render(<SignInScreen onSignIn={vi.fn()} />);

    expect(screen.queryByText(/could not reach/i)).not.toBeInTheDocument();
  });
});
