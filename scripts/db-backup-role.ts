/**
 * Crée (ou remet à jour) le compte de SAUVEGARDE « afrigest_backup » : lecture seule sur le schéma public, sans aucun droit d'écriture,
 * ni superutilisateur ni BYPASSRLS. C'est lui, et non le propriétaire de la base, dont le mot de passe est confié à GitHub pour la
 * sauvegarde nocturne (voir docs/EXPLOITATION.md §3 bis) : s'il fuitait, il permettrait de LIRE, jamais de modifier ou de supprimer.
 *
 * L'isolation entre entreprises (RLS forcée) s'applique à lui comme à tout le monde : la sauvegarde pose donc, comme l'application,
 * le réglage de session `app.bypass_rls = on` (PGOPTIONS) pour lire toutes les lignes.
 *
 *   DIRECT_URL=<connexion propriétaire> BACKUP_DB_PASSWORD=<mot de passe, 20 caractères minimum> npm run db:backup-role
 */
import "dotenv/config";
import { Client } from "pg";

export const BACKUP_ROLE = "afrigest_backup";
export const MIN_PASSWORD_LENGTH = 20;

type Queryable = Pick<Client, "query" | "escapeLiteral">;

/** Idempotent : peut être relancé pour changer le mot de passe ou après l'ajout de nouvelles tables. */
export async function ensureBackupRole(client: Queryable, password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Le mot de passe de sauvegarde doit faire ${MIN_PASSWORD_LENGTH} caractères au minimum.`);
  await client.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${BACKUP_ROLE}') THEN
      CREATE ROLE ${BACKUP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    END IF;
  END $$`);
  // deux connexions au plus : une sauvegarde n'en a pas besoin de plus.
  // Pas de NOSUPERUSER / NOBYPASSRLS ici : sur les bases gérées (Render…), le propriétaire n'est pas super-utilisateur et PostgreSQL
  // refuse alors toute mention de ces attributs, même pour les retirer. Le compte les a déjà (CREATE ROLE ci-dessus) ; on le vérifie.
  await client.query(`ALTER ROLE ${BACKUP_ROLE} WITH LOGIN CONNECTION LIMIT 2 PASSWORD ${client.escapeLiteral(password)}`);
  const attrs = await client.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '${BACKUP_ROLE}'`);
  if (attrs.rows[0]?.rolsuper || attrs.rows[0]?.rolbypassrls) {
    throw new Error(`Le compte ${BACKUP_ROLE} existe déjà avec des droits trop larges (super-utilisateur ou contournement de l'isolation) : supprimez-le (DROP ROLE ${BACKUP_ROLE}) puis relancez.`);
  }
  await client.query(`GRANT USAGE ON SCHEMA public TO ${BACKUP_ROLE}`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${BACKUP_ROLE}`);
  await client.query(`GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${BACKUP_ROLE}`);
  // les futures tables (migrations suivantes, créées par le même propriétaire) sont lisibles sans relancer ce script
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${BACKUP_ROLE}`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO ${BACKUP_ROLE}`);
}

async function main() {
  const url = process.env.DIRECT_URL;
  const password = process.env.BACKUP_DB_PASSWORD;
  if (!url || !password) throw new Error("DIRECT_URL (connexion propriétaire) et BACKUP_DB_PASSWORD sont requis.");

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await ensureBackupRole(client, password);
    console.log(`Rôle ${BACKUP_ROLE} prêt (lecture seule) sur ${new URL(url).host}.`);
    console.log("URL à confier à GitHub (secret BACKUP_DATABASE_URL) : même hôte et même base, utilisateur " + BACKUP_ROLE + ", ce mot de passe, ?sslmode=require");
  } finally {
    await client.end();
  }
}

// exécuté en ligne de commande seulement (importé par un test, il ne se connecte à rien)
if (process.argv[1] && /db-backup-role\.[cm]?[tj]s$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
