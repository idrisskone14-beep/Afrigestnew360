import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/core/errors";

/**
 * Abstraction de stockage de fichiers. Implémentation disque pour le développement et les
 * déploiements simples ; une implémentation S3-compatible se branche en implémentant la même interface.
 * Les clés sont toujours préfixées par l'identifiant d'entreprise (`<companyId>/…`).
 */
export interface StorageProvider {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

// Le dossier est configurable à l'exécution : on évite que le bundler trace tout le projet.
const ROOT = path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR ?? "uploads");
const SAFE_KEY = /^[0-9a-f-]{36}\/[\w.-]{1,100}$/i;

function resolveKey(key: string): string {
  if (!SAFE_KEY.test(key)) throw new AppError("VALIDATION", "Clé de fichier invalide.");
  const full = path.resolve(/* turbopackIgnore: true */ ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw new AppError("VALIDATION", "Clé de fichier invalide.");
  return full;
}

export const diskStorage: StorageProvider = {
  async put(key, data) {
    const full = resolveKey(key);
    await mkdir(/* turbopackIgnore: true */ path.dirname(full), { recursive: true });
    await writeFile(/* turbopackIgnore: true */ full, data);
  },
  async get(key) {
    try {
      return await readFile(/* turbopackIgnore: true */ resolveKey(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  },
  async delete(key) {
    await rm(/* turbopackIgnore: true */ resolveKey(key), { force: true });
  },
};

export const storage: StorageProvider = diskStorage;

// ── Logos ─────────────────────────────────────────────────────

export const LOGO_MAX_BYTES = 1_000_000;

const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", ext: "webp", test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
];

/** Détecte le type réel d'après les octets (jamais d'après le nom ou le type déclaré). SVG refusé (risque XSS). */
export function detectImage(data: Buffer): { mime: string; ext: string } | null {
  const sig = SIGNATURES.find((s) => s.test(data));
  return sig ? { mime: sig.mime, ext: sig.ext } : null;
}

export async function saveCompanyLogo(companyId: string, data: Buffer): Promise<{ key: string; mime: string }> {
  if (data.length === 0) throw new AppError("VALIDATION", "Fichier vide.");
  if (data.length > LOGO_MAX_BYTES) throw new AppError("VALIDATION", "Le logo ne doit pas dépasser 1 Mo.");
  const type = detectImage(data);
  if (!type) throw new AppError("VALIDATION", "Format non supporté : utilisez PNG, JPEG ou WebP.");
  const key = `${companyId}/logo.${type.ext}`;
  // un seul logo par entreprise : on retire les autres extensions
  await Promise.all(SIGNATURES.filter((s) => s.ext !== type.ext).map((s) => storage.delete(`${companyId}/logo.${s.ext}`)));
  await storage.put(key, data);
  return { key, mime: type.mime };
}

export async function readCompanyLogo(companyId: string): Promise<{ data: Buffer; mime: string } | null> {
  for (const s of SIGNATURES) {
    const data = await storage.get(`${companyId}/logo.${s.ext}`);
    if (data) return { data, mime: s.mime };
  }
  return null;
}
