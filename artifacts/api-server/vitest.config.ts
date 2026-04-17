import { defineConfig } from "vitest/config";
import os from "os";

const cpus = os.cpus().length;

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: Math.max(2, Math.min(cpus, 6)),
        minForks: 2,
      },
    },
    passWithNoTests: true,
  },
});
