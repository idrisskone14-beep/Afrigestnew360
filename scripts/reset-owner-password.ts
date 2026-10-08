/**
 * Secours : réinitialise le mot de passe d'un administrateur de la plateforme (compte propriétaire), sans passer par l'e-mail.
 * À lancer depuis un poste de confiance, avec la connexion PROPRIÉTAIRE de la base (DIRECT_URL).
 *
 *   OWNER_EMAIL="vous@exemple.com" NEW_PASSWORD="<nouveau mot de passe fort>" npm run db:owner-password
 *
 * Ce que fait le script (et rien d'autre) :
 *  - refuse tout compte qui n'est pas administrateur de la plateforme ;
 *  - exige un mot de passe respectant la politique (10 caractères min., majuscule, minuscule, chiffre) ;
 *  - remplace le mot de passe, remet le compteur d'échecs à zéro, lève le verrouillage, réactive le compte ;
 *  - ferme TOUTES les sessions ouvertes de ce compte (révocation immédiate) ;
 *  - ne désactive ni n'affiche aucun secret ; le mot de passe n'est jamais journalisé.
 */
import "dotenv/config";
import { Client } from "pg";
import { hashPassword, passwordSchema } from "../src/core/auth/password";

async function main() {
  const url = process.env.DIRECT_URL;
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.NEW_PASSWORD;
  if (!url || !email || !password) throw new Error("DIRECT_URL, OWNER_EMAIL et NEW_PASSWORD sont requis.");
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) throw new Error(`Mot de passe refusé : ${parsed.error.issues.map((i) => i.message).join(" ; ")}`);

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const host = new URL(url).hostname;
    const hash = await hashPassword(password);
    const upd = await client.query<{ id: string }>(
      `UPDATE "User"
          SET "passwordHash" = $1, "failedLoginCount" = 0, "lockedUntil" = NULL, "status" = 'ACTIVE',
              "emailVerifiedAt" = COALESCE("emailVerifiedAt", now())
        WHERE lower("email") = $2 AND "isPlatformAdmin" = true AND "deletedAt" IS NULL
        RETURNING "id"`,
      [hash, email],
    );
    const id = upd.rows[0]?.id;
    if (!id) throw new Error("Aucun administrateur de plateforme avec cette adresse : rien n'a été modifié.");
    const rev = await client.query(`UPDATE "UserSession" SET "revokedAt" = now() WHERE "userId" = $1 AND "revokedAt" IS NULL`, [id]);
    console.log(`Mot de passe réinitialisé pour ${email} sur ${host} ; ${rev.rowCount ?? 0} session(s) fermée(s). Connectez-vous avec le nouveau mot de passe.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
