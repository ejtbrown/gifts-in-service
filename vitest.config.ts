import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "ai-eval",
          include: ["tests/ai-eval/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
});
