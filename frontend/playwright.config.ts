import { defineConfig, devices } from "@playwright/test";

const backendUrl = process.env.E2E_BACKEND_URL;
const demoUrl = "http://127.0.0.1:4174";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/playwright",
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: backendUrl ?? demoUrl,
    trace: "retain-on-failure",
  },
  webServer: backendUrl
    ? undefined
    : {
        command: "npm run dev -- --port 4174 --strictPort",
        url: demoUrl,
      },
});
