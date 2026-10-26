/**
 * Tailles maximales des fichiers envoyés (documents, imports), en Mo.
 *
 * Sur Vercel, le corps d'une requête de fonction est plafonné à 4,5 Mo : au-delà, la plateforme répond 413 AVANT d'atteindre
 * l'application (aucun message clair pour l'utilisateur). Les limites y sont donc ramenées à 4 Mo, et vérifiées côté navigateur
 * comme côté serveur. Hors Vercel (serveur à nous), les limites d'origine s'appliquent.
 * `NEXT_PUBLIC_ON_VERCEL` est posée à la construction par next.config.ts (valeur lisible dans le navigateur).
 *
 * Lever ce plafond demande un envoi direct vers le stockage S3 (URL signée) : voir docs/EXPLOITATION.md.
 */
export const ON_VERCEL = process.env.NEXT_PUBLIC_ON_VERCEL === "1";
export const DOC_MAX_MB = ON_VERCEL ? 4 : 8;
export const IMPORT_MAX_MB = ON_VERCEL ? 4 : 5;
export const mb = (n: number) => n * 1024 * 1024;
