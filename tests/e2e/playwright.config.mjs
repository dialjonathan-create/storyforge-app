// Studio browser tests: the built app against tests/e2e/fakeStudioServer.mjs (synthetic prose).
//   npm run test:e2e
import { defineConfig } from "@playwright/test";

const PORT = 4319;
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.mjs/,
  outputDir: "./results",
  timeout: 45_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1440, height: 900 }, trace: "retain-on-failure" },
  webServer: {
    command: `VITE_ABILITY_URL=http://127.0.0.1:${PORT} npx vite build --outDir tests/e2e/.dist --emptyOutDir && node tests/e2e/fakeStudioServer.mjs ${PORT} tests/e2e/.dist`,
    cwd: "../..",
    url: `http://127.0.0.1:${PORT}/__state`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
