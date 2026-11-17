/**
 * Rétention des sauvegardes nocturnes : choisit les sauvegardes à supprimer du stockage externe.
 * Appelé par .github/workflows/backup.yml (Node ≥ 22.6, `--experimental-strip-types`) : lit les clés du stockage sur l'entrée
 * standard (une par ligne) et écrit sur la sortie celles à supprimer. Aucune suppression ici : le workflow s'en charge.
 *
 * Garde-fous, pour qu'un défaut de ce code ne puisse jamais vider le stockage :
 *   - seuls les fichiers nommés `kako-gestion-AAAA-MM-JJThh-mm-ssZ.dump.gpg` sont considérés : tout autre fichier est ignoré ;
 *   - les `minKeep` sauvegardes les plus récentes sont TOUJOURS conservées, quel que soit leur âge ;
 *   - une sauvegarde plus récente que `keepDays` n'est jamais supprimée (ni une datée du futur) ;
 *   - au plus `maxDelete` suppressions par exécution (les plus anciennes d'abord).
 */

const NAME = /(?:^|\/)kako-gestion-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.dump\.gpg$/;
const DAY = 86_400_000;

export interface RetentionOptions { keepDays: number; minKeep: number; maxDelete: number; now: Date }

/** Date d'une sauvegarde d'après son nom, ou null si le nom n'est pas celui d'une sauvegarde. */
export function backupDate(key: string): Date | null {
  const m = NAME.exec(key.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // refuse les dates impossibles (30 février…) que Date.UTC « corrigerait » en silence
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

export function expiredBackups(keys: string[], opts: RetentionOptions): string[] {
  if (!Number.isInteger(opts.keepDays) || opts.keepDays < 7) throw new Error("La durée de conservation doit être d'au moins 7 jours.");
  if (!Number.isInteger(opts.minKeep) || opts.minKeep < 1) throw new Error("Il faut conserver au moins 1 sauvegarde.");
  if (!Number.isInteger(opts.maxDelete) || opts.maxDelete < 0) throw new Error("Nombre maximal de suppressions invalide.");

  const backups = keys
    .map((k) => k.trim())
    .map((key) => ({ key, date: backupDate(key) }))
    .filter((b): b is { key: string; date: Date } => b.date !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime() || (a.key < b.key ? 1 : -1)); // les plus récentes d'abord

  const cutoff = opts.now.getTime() - opts.keepDays * DAY;
  return backups
    .slice(opts.minKeep)
    .filter((b) => b.date.getTime() < cutoff)
    .map((b) => b.key)
    .reverse() // les plus anciennes d'abord
    .slice(0, opts.maxDelete);
}

async function main() {
  const { createInterface } = await import("node:readline");
  const keys: string[] = [];
  for await (const line of createInterface({ input: process.stdin })) if (line.trim()) keys.push(line);
  const num = (name: string, fallback: number) => (process.env[name] ? Number(process.env[name]) : fallback);
  const expired = expiredBackups(keys, { keepDays: num("RETENTION_DAYS", 30), minKeep: num("MIN_KEEP", 7), maxDelete: num("MAX_DELETE", 20), now: new Date() });
  for (const k of expired) console.log(k);
  console.error(`${keys.length} fichier(s) listé(s), ${keys.filter((k) => backupDate(k)).length} sauvegarde(s) reconnue(s), ${expired.length} à supprimer.`);
}

// exécuté en ligne de commande seulement (importé par un test, il ne lit rien)
if (process.argv[1] && /backup-retention\.[cm]?[tj]s$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
