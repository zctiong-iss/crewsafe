/** @author Zhong Cheng (with assistance from Claude) */
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `authConfig.ts` calls `required()` for each Cognito setting at module load. A missing
 * `VITE_*` variable must fail at startup naming itself — not later, at redirect time, as
 * Cognito's opaque `invalid_request` error.
 */
describe("authConfig", () => {
  afterEach(() => {
    // Restore the baseline setup.ts stubs so later test files see the values they expect.
    vi.stubEnv("VITE_COGNITO_AUTHORITY", "https://cognito-idp.test.amazonaws.com/test_pool");
    vi.stubEnv("VITE_COGNITO_CLIENT_ID", "test-client-id");
    vi.stubEnv("VITE_COGNITO_HOSTED_UI_DOMAIN", "https://test-domain.auth.test.amazoncognito.com");
    vi.stubEnv("VITE_REDIRECT_URI", "http://localhost:5173/callback");
    vi.stubEnv("VITE_POST_LOGOUT_REDIRECT_URI", "http://localhost:5173/");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8080");
  });

  const REQUIRED_VARS = [
    "VITE_COGNITO_AUTHORITY",
    "VITE_COGNITO_CLIENT_ID",
    "VITE_REDIRECT_URI",
    "VITE_API_BASE_URL",
    "VITE_COGNITO_HOSTED_UI_DOMAIN",
  ] as const;

  it.each(REQUIRED_VARS)("throws naming %s when it is missing", async (missingVar) => {
    // required() treats an empty string the same as absent (`if (!value)`).
    vi.stubEnv(missingVar, "");
    vi.resetModules();

    await expect(import("./authConfig")).rejects.toThrow(missingVar);
  });

  it("builds the OIDC settings from the injected Cognito configuration when all variables are present", async () => {
    vi.resetModules();
    const { authConfig, apiBaseUrl } = await import("./authConfig");

    expect(authConfig.authority).toBe("https://cognito-idp.test.amazonaws.com/test_pool");
    expect(authConfig.client_id).toBe("test-client-id");
    expect(authConfig.redirect_uri).toBe("http://localhost:5173/callback");
    expect(authConfig.post_logout_redirect_uri).toBe("http://localhost:5173/");
    expect(apiBaseUrl).toBe("http://localhost:8080");
  });
});
