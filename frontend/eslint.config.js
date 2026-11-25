import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import imports from "eslint-plugin-import";
import hooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": hooks, import: imports },
    settings: {
      "import/resolver": { node: { extensions: [".js", ".ts", ".tsx"] } },
    },
    rules: {
      ...hooks.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "error",
      "import/no-cycle": "error",
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./src/shared",
              from: [
                "./src/app",
                "./src/pages",
                "./src/widgets",
                "./src/features",
              ],
            },
            {
              target: "./src/features",
              from: ["./src/app", "./src/pages", "./src/widgets"],
            },
            { target: "./src/widgets", from: ["./src/app", "./src/pages"] },
            { target: "./src/pages", from: "./src/app" },
          ],
        },
      ],
    },
  },
  prettier,
);
