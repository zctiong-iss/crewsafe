import { fileURLToPath, URL } from "node:url";
// From vitest/config, not vite: the `test` block below is not part of Vite's own schema.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // tsconfig paths only teach the type-checker. Vite needs its own alias or the
      // build resolves nothing.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // Fixed, not "whatever is free". Cognito rejects any redirect_uri that is not
    // registered on the app client, and http://localhost:5173/callback is what
    // infra/terraform/cognito registers. A different port means a failed login.
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // Pin the host clock so a developer's machine and CI agree.
    //
    // This makes the suite deterministic; it does NOT make the app correct. The read path
    // pins Asia/Singapore itself (formatShiftRange), but the write path still converts a
    // picked Date with `toISOString()` using whatever zone the *browser* is in — so a
    // supervisor whose laptop is not on SGT files a shift at the wrong instant. Without
    // this line that gap shows up as a CI-only failure; with it, the gap is invisible
    // until someone closes it at the form boundary (needs the site's own `timezone`
    // field and a zone-aware parse, e.g. date-fns-tz `fromZonedTime`).
    env: { TZ: "Asia/Singapore" },
  },
});
