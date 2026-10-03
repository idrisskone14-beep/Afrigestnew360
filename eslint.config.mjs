import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const PLATFORM_ONLY = {
  paths: [
    {
      name: "@/core/db/client",
      importNames: ["platformDb", "platformTransaction", "baseClient"],
      message:
        "Client plateforme (contourne la RLS) : r?serv? ? src/core, src/modules/platform et /super-admin. Utilisez ctx.db / ctx.tx.",
    },
  ],
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "node_modules/**", "src/generated/**", ".pgdata/**", "coverage/**", "next-env.d.ts"]),
  {
    rules: {
      "no-restricted-imports": ["error", PLATFORM_ONLY],
      "no-restricted-properties": [
        "error",
        { property: "$queryRawUnsafe", message: "SQL brut non param?tr? interdit." },
        { property: "$executeRawUnsafe", message: "SQL brut non param?tr? interdit." },
      ],
      "react/no-unescaped-entities": "off", // texte français : apostrophes courantes
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: [
      "src/core/**",
      "src/modules/platform/**",
      "src/app/super-admin/**",
      "prisma/**",
      "scripts/**",
      "tests/**",
    ],
    rules: { "no-restricted-imports": "off" },
  },
  { files: ["tests/**"], rules: { "no-restricted-properties": "off" } },
]);
