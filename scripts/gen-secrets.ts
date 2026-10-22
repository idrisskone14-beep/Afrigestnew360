/**
 * Génère les secrets d'un nouvel environnement (production, préproduction). À lancer sur VOTRE poste :
 *   npm run secrets
 * puis à copier dans les variables d'environnement de l'hébergeur (Vercel → Settings → Environment Variables).
 * Rien n'est écrit sur disque ni envoyé nulle part. Ne partagez pas ces valeurs et ne les commitez jamais.
 * Les notifications push ont leur propre commande : `npm run push:keys`.
 */
import { randomBytes } from "node:crypto";

const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const url = (bytes: number) => randomBytes(bytes).toString("base64url"); // sans / + = : utilisable tel quel dans une URL de base

console.log("\nCopiez ces lignes dans les variables d'environnement (Production) :\n");
console.log(`AUTH_SECRET=${randomBytes(32).toString("base64")}`);
console.log(`ENCRYPTION_KEY=${hex(32)}`);
console.log(`CRON_SECRET=${hex(24)}`);
console.log("\nBase de données (mot de passe du rôle applicatif « afrigest_app », à mettre dans DATABASE_URL) :\n");
console.log(`APP_DB_PASSWORD=${url(24)}`);
console.log("\nCompte propriétaire de la plateforme (premier seed uniquement ; à changer après la première connexion) :\n");
console.log(`PLATFORM_OWNER_PASSWORD=${url(18)}Aa1!\n`);
console.log("Conservez ENCRYPTION_KEY dans un gestionnaire de mots de passe : la perdre rend illisibles les secrets 2FA déjà enregistrés.\n");
