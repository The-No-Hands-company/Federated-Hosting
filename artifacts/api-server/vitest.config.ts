import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Runs before every test file, so the suite is runnable from a clean
    // shell. Without it three files fail to import and vitest still prints a
    // green count for the rest. See tests/setup.ts.
    setupFiles: ["./tests/setup.ts"],
  },
});
