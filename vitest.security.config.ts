import { defineConfig } from "vitest/config";

// Dedicated config for database security tests (P7). These require a LIVE Supabase
// project (local `supabase start` or a real project) plus a service-role key to mint
// two real users. They are intentionally excluded from the default offline suite and
// run via `npm run test:security`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/security.rls.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
