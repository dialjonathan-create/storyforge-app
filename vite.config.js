import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
