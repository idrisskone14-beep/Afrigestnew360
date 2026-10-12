/**
 * Synchronise le catalogue modules / permissions avec la base (idempotent). Exécuté à chaque déploiement (`vercel-build`) :
 * une permission ajoutée au code existe ainsi en production, et les rôles issus d'un gabarit la reçoivent si le gabarit la prévoit.
 */
import "dotenv/config";
import { platformDb } from "@/core/db/client";
import { syncCatalog } from "@/core/tenant/provisioning";

async function main() {
  const res = await syncCatalog(platformDb);
  console.log(`Catalogue synchronisé${res?.added.length ? ` — nouvelles permissions : ${res.added.join(", ")}` : ""}.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
