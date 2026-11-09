import { defineConfig } from "@playwright/test";

// Uses the installed Google Chrome; no browser download needed.
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:4173", channel: "chrome" },
  webServer: {
    command: "npm run build && npm run preview -- --port 4173",
    port: 4173,
    reuseExistingServer: true,
  },
});
