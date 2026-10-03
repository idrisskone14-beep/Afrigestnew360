/**
 * Active la connexion du rôle applicatif `afrigest_app` (créé NOLOGIN par la migration RLS).
 *   npm run db:app-role
 */
import "dotenv/config";
import { Client } from "pg";

async function main() {
  const url = process.env.DIRECT_URL;
  const password = process.env.APP_DB_PASSWORD;
  if (!url || !password) throw new Error("DIRECT_URL et APP_DB_PASSWORD sont requis.");

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`ALTER ROLE afrigest_app WITH LOGIN PASSWORD ${client.escapeLiteral(password)}`);
    console.log("Rôle afrigest_app : LOGIN activé.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
