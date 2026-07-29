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
    // infra/aws/cognito-staging registers. A different port means a failed login.
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
