import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/** Serves tests/device/*.html for on-device checks. Not part of CI. */
export default defineConfig({
  plugins: [react()],
  root: path.resolve("tests/device"),
  publicDir: false,
  base: "./",
  server: { port: 5174, strictPort: true, fs: { allow: [path.resolve(".")] } },
  // `vite build` output is what an iOS home-screen web app loads reliably; the
  // dev server's unbundled modules left it blank in the Simulator.
  build: {
    outDir: path.resolve("tests/device/.dist"),
    emptyOutDir: true,
    rollupOptions: { input: path.resolve("tests/device/composer.html") },
  },
});
