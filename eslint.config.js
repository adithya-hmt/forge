import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// The repository already contains targeted `react-hooks/exhaustive-deps` disable
// comments, but does not depend on eslint-plugin-react-hooks. Register the rule name
// as a no-op so those existing directives are valid rather than ESLint config errors.
const reactHooksCompat = {
  rules: {
    "exhaustive-deps": {
      meta: { type: "problem", schema: [] },
      create() { return {}; },
    },
  },
};

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "supabase/functions/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooksCompat },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // boundary.ts intentionally detects ASCII control characters in untrusted input.
      "no-control-regex": "off",
    },
  },
);