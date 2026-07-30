/**
 * @author Jemilin Beulah
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// The app reads these at module load. Set before any import that touches authConfig.
vi.stubEnv("VITE_COGNITO_AUTHORITY", "https://cognito-idp.test.amazonaws.com/test_pool");
vi.stubEnv("VITE_COGNITO_CLIENT_ID", "test-client-id");
vi.stubEnv("VITE_COGNITO_HOSTED_UI_DOMAIN", "https://test-domain.auth.test.amazoncognito.com");
vi.stubEnv("VITE_REDIRECT_URI", "http://localhost:5173/callback");
vi.stubEnv("VITE_POST_LOGOUT_REDIRECT_URI", "http://localhost:5173/");
vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8080");

// Node 25+ exposes an optional global localStorage that is undefined unless a
// persistence file is configured. That global can shadow jsdom's Storage on
// newer local runtimes, so provide a deterministic in-memory browser store.
if (!window.localStorage) {
  const values = new Map<string, string>();
  const localStore: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStore,
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
