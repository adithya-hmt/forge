import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Security tests that require a live Supabase project are opt-in; they self-skip
    // with a clear BLOCKED_BY_CREDENTIALS message when the env is absent (never a
    // silent pass). Run the default `npm test` for the offline suite.
    exclude: ["test/security.rls.test.ts", "node_modules/**"],
    reporters: "default",
  },
});
