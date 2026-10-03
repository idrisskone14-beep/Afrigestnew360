/**
 * PostgreSQL local pour le développement (aucune installation système requise).
 * En production, utiliser un PostgreSQL managé et ignorer ce script.
 *
 *   npm run db:start
 */
import { existsSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const PORT = Number(process.env.DEV_DB_PORT ?? 54329);
const DATA_DIR = path.resolve(process.cwd(), ".pgdata");
const DB_NAME = "afrigest";

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--no-locale"],
    onLog: () => undefined,
    onError: (e) => console.error(e),
  });

  if (!existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    console.log("Initialisation du cluster PostgreSQL…");
    await pg.initialise();
  }
  await pg.start();

  try {
    await pg.createDatabase(DB_NAME);
    console.log(`Base « ${DB_NAME} » créée.`);
  } catch {
    // existe déjà
  }

  console.log(`PostgreSQL prêt : postgresql://postgres:postgres@localhost:${PORT}/${DB_NAME}`);
  console.log("Ctrl+C pour arrêter.");

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  setInterval(() => undefined, 1 << 30);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
