/**
 * @author Jemilin Beulah
 */
import { describe, expect, it } from "vitest";
import { authConfig } from "./authConfig";

/**
 * Where tokens are allowed to live.
 *
 * ADR 0005 chose sessionStorage over localStorage: both are readable by any script that
 * achieves XSS, but sessionStorage is scoped to one tab and cleared when it closes, so a
 * shared machine does not keep a live session for whoever sits down next.
 *
 * This is asserted rather than trusted to code review because the failure is silent. A
 * one-word change to `localStorage` — the default in most oidc-client-ts examples — looks
 * harmless in a diff and quietly widens the blast radius of any XSS to every tab, and past
 * the end of the shift.
 */
describe("token storage", () => {
  it("keeps tokens in sessionStorage, never localStorage", () => {
    // oidc-client-ts holds the chosen Storage on the state store.
    const userStore = authConfig.userStore as unknown as { _store: Storage };
    const stateStore = authConfig.stateStore as unknown as { _store: Storage };

    expect(userStore._store).toBe(window.sessionStorage);
    expect(stateStore._store).toBe(window.sessionStorage);
    expect(userStore._store).not.toBe(window.localStorage);
  });

  it("uses the authorization code flow, never implicit", () => {
    // "token" or "id_token token" would put access tokens in the URL fragment, where they
    // reach browser history, referrer headers and server logs.
    expect(authConfig.response_type).toBe("code");
  });

  it("does not trust identity claims from the token", () => {
    // Role and site access come from GET /api/v1/me, so that a demotion takes effect on the
    // next request rather than whenever the token happens to expire.
    expect(authConfig.loadUserInfo).toBe(false);
  });
});
