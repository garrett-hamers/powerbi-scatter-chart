const eslint = require("@eslint/js");
const tseslint = require("@typescript-eslint/eslint-plugin");
const parser = require("@typescript-eslint/parser");
const globals = require("globals");

module.exports = [
  {
    ignores: ["dist/**", "dist-tests/**", "node_modules/**", ".tmp/**"]
  },
  eslint.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser,
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.test.json"],
        sourceType: "module"
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      "@typescript-eslint": tseslint
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
    }
  }
];
