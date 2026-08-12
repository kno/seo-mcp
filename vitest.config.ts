import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      reporter: ["text", "json", "html"],
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          exclude: ["test/integration/**"],
        },
      },
      "./vitest.integration.config.ts",
    ],
  },
});
