import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { versionJson } from "./build/versionJson.js";
import { checkBundleSecrets } from "./build/checkBundleSecrets.js";
import { securityHeaders } from "./build/securityHeaders.js";

export default defineConfig({
  plugins: [react(), versionJson(), checkBundleSecrets()],
  define: {
    __GIT_SHA__: JSON.stringify((process.env.VITE_GIT_SHA || "unknown").trim() || "unknown"),
  },
  server: {
    port: 5174,
  },
  preview: {
    // UI-10: CSP, no framing, HSTS, referrer policy -- on every response the
    // deployed service sends (it IS `vite preview`; see build/securityHeaders.js).
    headers: securityHeaders(),
    allowedHosts: [
      "storyforge-app-818269465014.us-central1.run.app",
      "storyforge-app-ilxnfkacda-uc.a.run.app",
    ],
  },
  build: {
    sourcemap: false,
  },
});
