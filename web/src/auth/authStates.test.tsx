/**
 * @author Jemilin Beulah
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "./AuthProvider";
import { App } from "@/app/App";
import { fakeUserManager } from "@/test/fakeUserManager";

/**
 * Which screen a user lands on, for each way a session can be.
 *
 * These are the states people actually hit — expired overnight, account not provisioned,
 * backend down — and each one has a different correct answer. Getting them wrong produces
 * the two worst outcomes in an authenticated app: an infinite spinner, or being logged out
 * for something that was not a session problem.
 */
function renderApp(session: Parameters<typeof fakeUserManager>[0], fetchImpl: typeof fetch) {
  vi.stubGlobal("fetch", fetchImpl);
  return render(
    <MemoryRouter>
      <AuthProvider userManager={fakeUserManager(session)}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const jsonResponse = (body: unknown, status = 200, requestId = "req-test-1") =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
  });

const currentUser = {
  id: "u-1",
  username: "supervisor1",
  displayName: "Aisyah",
  role: "SUPERVISOR",
  siteIds: [],
};

describe("auth states", () => {
  it("offers sign-in when there is no session", async () => {
    renderApp(null, vi.fn());

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("treats an expired token as signed out rather than showing a spinner", async () => {
    renderApp({ expired: true }, vi.fn());

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("renders the app once the backend resolves the user", async () => {
    renderApp({}, vi.fn().mockResolvedValue(jsonResponse(currentUser)));

    expect(await screen.findByRole("heading", { name: "Live Board" })).toBeInTheDocument();
  });

  /**
   * The inference the whole "not provisioned" screen rests on. The API returns an
   * indistinguishable 401 for every cause, so the client reasons from what it knows: the
   * token is valid and unexpired, therefore the missing piece is the local account.
   */
  it("reads a 401 on a valid token as an unprovisioned account, not a bad session", async () => {
    renderApp({}, vi.fn().mockResolvedValue(jsonResponse({ error: "Unauthorized" }, 401)));

    expect(await screen.findByRole("heading", { name: "Account not set up yet" })).toBeInTheDocument();
    // Crucially it does not dump the user back at sign-in, which would tell them nothing.
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("shows the request id so a user can quote it", async () => {
    renderApp({}, vi.fn().mockResolvedValue(jsonResponse({ error: "Unauthorized" }, 401, "req-abc-123")));

    expect(await screen.findByText("req-abc-123")).toBeInTheDocument();
  });

  it("distinguishes an unreachable backend from a broken one", async () => {
    renderApp({}, vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    expect(await screen.findByRole("heading", { name: "Cannot reach CrewSafe" })).toBeInTheDocument();
    // The session is fine, so signing out would be the wrong remedy to lead with.
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("offers a retry rather than a dead end when the backend errors", async () => {
    renderApp({}, vi.fn().mockResolvedValue(jsonResponse({ error: "Internal Server Error" }, 500)));

    expect(await screen.findByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
