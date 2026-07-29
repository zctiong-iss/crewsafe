import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// The app reads these at module load. Set before any import that touches authConfig.
vi.stubEnv("VITE_COGNITO_AUTHORITY", "https://cognito-idp.test.amazonaws.com/test_pool");
vi.stubEnv("VITE_COGNITO_CLIENT_ID", "test-client-id");
vi.stubEnv("VITE_REDIRECT_URI", "http://localhost:5173/callback");
vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8080");

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
