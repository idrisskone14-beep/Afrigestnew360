/**
 * Démarre un PostgreSQL éphémère (réel) pour les tests d'intégration, applique les migrations,
 * active le rôle applicatif et charge le catalogue (modules, permissions, offres).
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const PORT = 54330;
const DB = "afrigest_test";

export default async function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "afg-test-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--no-locale"],
    onLog: () => undefined,
    onError: () => undefined,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB);

  const env = {
    ...process.env,
    DIRECT_URL: `postgresql://postgres:postgres@localhost:${PORT}/${DB}`,
    DATABASE_URL: `postgresql://afrigest_app:test_app_pw@localhost:${PORT}/${DB}`,
    APP_DB_PASSWORD: "test_app_pw",
    ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    SEED_DEMO: "false",
    PLATFORM_OWNER_EMAIL: "",
    PLATFORM_OWNER_PASSWORD: "",
  };
  const run = (cmd: string) => execSync(cmd, { env, stdio: "pipe", cwd: process.cwd() });
  run("npx prisma migrate deploy");
  run("npx tsx scripts/db-app-role.ts");
  run("npx tsx --conditions=react-server prisma/seed.ts");

  return async () => {
    await pg.stop();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* fichiers verrouillés sous Windows : sans conséquence (dossier temporaire) */
    }
  };
}
