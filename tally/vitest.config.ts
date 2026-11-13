import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // node:sqlite is still marked experimental; keep its warning out of test output.
    poolOptions: { forks: { execArgv: ["--disable-warning=ExperimentalWarning"] } },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts"],
      reporter: ["text-summary", "json-summary"],
    },
  },
});
