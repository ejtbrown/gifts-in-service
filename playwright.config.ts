import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const localChromium = "/snap/bin/chromium";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    ...(existsSync(localChromium)
      ? {
          launchOptions: {
            executablePath: localChromium,
            args: ["--no-sandbox", "--disable-dev-shm-usage"],
          },
        }
      : {}),
  },
  webServer: [
    {
      command:
        "bash -c 'set -a; source .env.example; set +a; pnpm --filter @gis/public-api dev'",
      url: "http://127.0.0.1:3001/api/config",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @gis/web dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
