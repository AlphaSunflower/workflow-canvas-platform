import { createRequire } from "node:module";

const frontendRequire = createRequire(new URL("../frontend/package.json", import.meta.url));
const tsParser = frontendRequire("@typescript-eslint/parser");
const tsPlugin = frontendRequire("@typescript-eslint/eslint-plugin");

export default [
  {
    ignores: [
      "api/dist/**",
      "worker/dist/**",
      "shared/dist/**",
      "**/*.d.ts",
    ],
  },
  {
    files: ["api/src/**/*.ts", "worker/src/**/*.ts", "shared/src/**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: tsParser,
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-var": "error",
      "prefer-const": "error",
    },
  },
];
