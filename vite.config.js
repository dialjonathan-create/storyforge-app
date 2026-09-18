import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { versionJson } from "./build/versionJson.js";

export default defineConfig({
  plugins: [react(), versionJson()],
  define: {
    __GIT_SHA__: JSON.stringify((process.env.VITE_GIT_SHA || "unknown").trim() || "unknown"),
  },
  server: {
    port: 5174,
  },
  preview: {
    allowedHosts: [
      "storyforge-app-818269465014.us-central1.run.app",
      "storyforge-app-ilxnfkacda-uc.a.run.app",
    ],
  },
  build: {
    sourcemap: false,
  },
});
