import { describe, expect, it } from "vitest";
import { backupDate, expiredBackups } from "../../scripts/backup-retention";

const NOW = new Date("2026-12-20T03:00:00Z");
const key = (iso: string, prefix = "backups/") => `${prefix}kako-gestion-${iso.replace(/:/g, "-").replace(/\.\d+Z$/, "Z")}.dump.gpg`;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const opts = { keepDays: 30, minKeep: 7, maxDelete: 20, now: NOW };

/** Une sauvegarde par nuit pendant `n` nuits (la plus récente date d'hier). */
const nightly = (n: number) => Array.from({ length: n }, (_, i) => key(daysAgo(i + 1)));

describe("rétention des sauvegardes", () => {
  it("reconnaît le nom d'une sauvegarde et refuse tout le reste, dates impossibles comprises", () => {
    expect(backupDate("backups/kako-gestion-2026-11-18T02-30-05Z.dump.gpg")?.toISOString()).toBe("2026-11-18T02:30:05.000Z");
    expect(backupDate("kako-gestion-2026-11-18T02-30-05Z.dump.gpg")).not.toBeNull();
    expect(backupDate("backups/kako-gestion-2026-02-30T02-30-05Z.dump.gpg")).toBeNull(); // 30 février
    expect(backupDate("backups/kako-gestion-2026-11-18T25-30-05Z.dump.gpg")).toBeNull();
    expect(backupDate("backups/notes.txt")).toBeNull();
    expect(backupDate("backups/kako-gestion-2026-11-18T02-30-05Z.dump")).toBeNull(); // non chiffrée : pas la nôtre
    expect(backupDate("backups/evil-kako-gestion-2026-11-18T02-30-05Z.dump.gpg")).toBeNull();
  });

  it("supprime ce qui a plus de 30 jours, garde le reste", () => {
    const keys = nightly(45);
    const expired = expiredBackups(keys, opts);
    expect(expired.every((k) => backupDate(k)!.getTime() < NOW.getTime() - 30 * 86_400_000)).toBe(true);
    // frontière : vieille d'exactement 30 jours = conservée ; de 31 jours = supprimée (il y a 15 sauvegardes de 31 à 45 jours)
    expect(expired).toHaveLength(15);
    expect(expired).not.toContain(key(daysAgo(30)));
    expect(expired).toContain(key(daysAgo(31)));
    expect(expired).not.toContain(keys[0]);
  });

  it("les plus anciennes sont supprimées en premier", () => {
    const expired = expiredBackups(nightly(40), opts);
    const dates = expired.map((k) => backupDate(k)!.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
  });

  it("garde toujours les 7 plus récentes, même si TOUTES sont périmées (sauvegardes interrompues depuis des mois)", () => {
    const old = Array.from({ length: 12 }, (_, i) => key(daysAgo(200 + i)));
    const expired = expiredBackups(old, opts);
    expect(expired).toHaveLength(5);
    const kept = old.filter((k) => !expired.includes(k));
    expect(kept).toHaveLength(7);
    // ce sont bien les 7 plus récentes qui restent
    expect(kept.map((k) => backupDate(k)!.getTime()).sort((a, b) => b - a)).toEqual(old.map((k) => backupDate(k)!.getTime()).sort((a, b) => b - a).slice(0, 7));
  });

  it("ne touche à rien d'autre : fichiers inconnus, autres dossiers, sauvegardes datées du futur", () => {
    const keys = [...nightly(40), "backups/README.txt", "backups/kako-gestion-2026-01-01T00-00-00Z.dump", "autre/dossier/fichier.bin", key(new Date(NOW.getTime() + 5 * 86_400_000).toISOString())];
    const expired = expiredBackups(keys, opts);
    expect(expired.every((k) => /kako-gestion-.*\.dump\.gpg$/.test(k))).toBe(true);
    expect(expired).not.toContain("backups/README.txt");
    expect(expired).not.toContain("autre/dossier/fichier.bin");
    expect(expired).not.toContain(keys[keys.length - 1]);
  });

  it("plafonne les suppressions par exécution", () => {
    expect(expiredBackups(nightly(120), { ...opts, maxDelete: 5 })).toHaveLength(5);
    expect(expiredBackups(nightly(120), { ...opts, maxDelete: 0 })).toEqual([]);
  });

  it("ne supprime rien quand il n'y a rien de périmé, ou rien du tout", () => {
    expect(expiredBackups(nightly(20), opts)).toEqual([]);
    expect(expiredBackups([], opts)).toEqual([]);
    expect(expiredBackups(["", "  "], opts)).toEqual([]);
  });

  it("refuse des réglages dangereux", () => {
    expect(() => expiredBackups([], { ...opts, keepDays: 3 })).toThrow(/7 jours/);
    expect(() => expiredBackups([], { ...opts, keepDays: NaN })).toThrow();
    expect(() => expiredBackups([], { ...opts, minKeep: 0 })).toThrow(/au moins 1/);
    expect(() => expiredBackups([], { ...opts, maxDelete: -1 })).toThrow();
  });
});
