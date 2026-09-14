import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/** The width check builds its own harness rather than using the dev server:
 *  a build either produces files or fails loudly, where a dev server is a
 *  background process a CI runner can race. It raced, on the first run. */
export default defineConfig({
  plugins: [react()],
  base: "./",
  // The app's public/ folder holds a 4.7 MB basemap; the harness needs none of
  // it, and copying it would make the check slower than the thing it checks.
  publicDir: false,
  build: {
    outDir: path.resolve("tests/layout/.dist"),
    emptyOutDir: true,
    rollupOptions: { input: path.resolve("tests/layout/harness.html") },
  },
});
