import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  // Migrations / seed : connexion PROPRIÉTAIRE (le rôle applicatif ne peut pas créer de tables).
  datasource: { url: env("DIRECT_URL") },
});
