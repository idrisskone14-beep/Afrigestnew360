import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  // Migrations / seed : connexion PROPRIÉTAIRE (le rôle applicatif ne peut pas créer de tables).
  // `prisma generate` (postinstall, CI, Vercel) n'a pas besoin de base : une URL factice évite l'échec quand
  // DIRECT_URL est absente ; toute commande qui se connecte réellement échoue alors avec une erreur de connexion explicite.
  datasource: { url: process.env.DIRECT_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder" },
});
