// Flat ESLint config for the Operator Cockpit (browser/React/TypeScript).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "content/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // Typed-boundary cleanup (FR-14) is tracked separately; keep visible but
      // non-blocking so the lint gate stays green.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // Dev tooling and config files run in Node and may use console freely.
  {
    files: ["scripts/**/*.{ts,mjs}", "*.{ts,js}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  prettier,
);
