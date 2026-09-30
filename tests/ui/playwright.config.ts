import { defineConfig } from "@playwright/test";

// Browser tests for our PhotonVision build, run from the laptop against the live Jetson.
// See README.md in this folder. They never reset the Jetson: every test works on a temporary
// pipeline ("zz-uitest") and puts back anything it changes.
export default defineConfig({
  testDir: "./specs",
  globalSetup: "./lib/global-setup.ts",
  // One browser at a time: the tests share the Jetson's cameras.
  workers: 1,
  fullyParallel: false,
  timeout: 5 * 60_000,
  expect: { timeout: 5_000 },
  reporter: [["list"], ["html", { outputFolder: "report", open: "never" }]],
  outputDir: "results",
  use: {
    baseURL: process.env.PV_URL ?? "http://localhost:5800",
    // The laptop's own Chrome, so nothing extra to download.
    channel: "chrome",
    headless: process.env.PV_UI_HEADED !== "1",
    viewport: { width: 1920, height: 1080 },
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  }
});
