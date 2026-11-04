import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // tests/e2e is Playwright's (npm run test:e2e), not vitest's.
    exclude: ["**/node_modules/**", "tests/e2e/**", "tests/layout/**"],
  },
});
