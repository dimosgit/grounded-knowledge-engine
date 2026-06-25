// Flat ESLint config for the engine (Node/TypeScript). The Cockpit has its own
// config under apps/cockpit because it is a separate package with a browser/React
// target and its own dependency tree.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "content/**", "apps/**", "examples/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // The codebase intentionally uses leading-underscore names to mark
      // deliberately unused bindings (e.g. destructured rest, catch errors).
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // Tightening remaining `any` boundaries to `unknown`/discriminated unions
      // is tracked as its own workstream (FR-14). Surface it as a warning so the
      // debt stays visible without blocking the lint gate.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // Keep ESLint focused on correctness; Prettier owns formatting.
  prettier,
);
