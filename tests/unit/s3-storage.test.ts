import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkEnv } from "@/core/env";
import { createS3Storage, s3ConfigFromEnv } from "@/core/storage/s3";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const KEY = `${COMPANY}/logo.png`;
class S3Error extends Error { constructor(public override name: string, public $metadata: { httpStatusCode: number }) { super(name); } }

/** Faux client S3 en mémoire : mêmes commandes que le vrai SDK, sans réseau. */
function fakeS3() {
  const objects = new Map<string, Buffer>();
  const calls: string[] = [];
  const client = {
    async send(cmd: unknown) {
      const input = (cmd as { input: { Bucket: string; Key: string; Body?: Buffer } }).input;
      const id = `${input.Bucket}/${input.Key}`;
      if (cmd instanceof PutObjectCommand) { calls.push(`PUT ${id}`); objects.set(id, Buffer.from(input.Body!)); return {}; }
      if (cmd instanceof GetObjectCommand) {
        calls.push(`GET ${id}`);
        const data = objects.get(id);
        if (!data) throw new S3Error("NoSuchKey", { httpStatusCode: 404 });
        return { Body: { transformToByteArray: async () => new Uint8Array(data) } };
      }
      if (cmd instanceof DeleteObjectCommand) { calls.push(`DEL ${id}`); objects.delete(id); return {}; }
      throw new Error("commande inattendue");
    },
  };
  return { client, objects, calls };
}

describe("stockage S3-compatible", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  const cfg = { bucket: "kako", region: "auto", accessKeyId: "id", secretAccessKey: "secret" };

  it("écrit, relit et supprime ; une clé absente se lit comme « introuvable » (null)", async () => {
    const { client, objects, calls } = fakeS3();
    const s = createS3Storage(cfg, client);
    await s.put(KEY, Buffer.from("logo"));
    expect(objects.get(`kako/${KEY}`)?.toString()).toBe("logo");
    expect((await s.get(KEY))?.toString()).toBe("logo");
    await s.delete(KEY);
    expect(await s.get(KEY)).toBeNull();
    await expect(s.delete(KEY)).resolves.toBeUndefined(); // supprimer un fichier absent n'est pas une erreur
    expect(calls[0]).toBe(`PUT kako/${KEY}`);
  });

  it("préfixe de dossier : plusieurs environnements peuvent partager un bucket", async () => {
    const { client, objects } = fakeS3();
    const s = createS3Storage({ ...cfg, prefix: "/prod/" }, client);
    await s.put(KEY, Buffer.from("x"));
    expect([...objects.keys()]).toEqual([`kako/prod/${KEY}`]);
    expect((await s.get(KEY))?.toString()).toBe("x");
  });

  it("une vraie panne (accès refusé, réseau) n'est PAS masquée en « introuvable »", async () => {
    const s = createS3Storage(cfg, { send: async () => { throw new S3Error("AccessDenied", { httpStatusCode: 403 }); } });
    await expect(s.get(KEY)).rejects.toMatchObject({ name: "AccessDenied" });
  });

  it("configuration lue dans l'environnement ; absente sans S3_BUCKET", () => {
    expect(s3ConfigFromEnv({})).toBeNull();
    expect(s3ConfigFromEnv({ S3_BUCKET: "b", S3_ACCESS_KEY_ID: "i", S3_SECRET_ACCESS_KEY: "s", S3_ENDPOINT: "https://x.r2.cloudflarestorage.com", S3_FORCE_PATH_STYLE: "true", S3_KEY_PREFIX: "prod" })).toEqual({
      bucket: "b", region: "auto", endpoint: "https://x.r2.cloudflarestorage.com", accessKeyId: "i", secretAccessKey: "s", forcePathStyle: true, prefix: "prod",
    });
  });

  it("le fournisseur actif suit S3_BUCKET ; une clé invalide est refusée avant tout appel réseau", async () => {
    vi.stubEnv("S3_BUCKET", "kako"); vi.stubEnv("S3_ACCESS_KEY_ID", "id"); vi.stubEnv("S3_SECRET_ACCESS_KEY", "secret"); vi.stubEnv("S3_ENDPOINT", "http://127.0.0.1:9");
    vi.resetModules();
    const mod = await import("@/core/storage");
    expect(mod.storageKind).toBe("s3");
    for (const bad of ["../etc/passwd", `${COMPANY}/../x`, "pas-une-cle", `${COMPANY}/a/b`]) await expect(mod.storage.get(bad)).rejects.toMatchObject({ code: "VALIDATION" });
    vi.unstubAllEnvs(); vi.resetModules();
    expect((await import("@/core/storage")).storageKind).toBe("disk");
  });
});

describe("contrôle de configuration : fichiers", () => {
  const base = { DATABASE_URL: "postgresql://x", AUTH_SECRET: "a".repeat(32), ENCRYPTION_KEY: "ab".repeat(32), APP_URL: "https://app.exemple.ci" };
  const files = (env: Record<string, string>) => checkEnv({ ...base, ...env }).filter((p) => /S3|disque|Fichiers/.test(p.message));

  it("Vercel sans S3_BUCKET : bloquant (les fichiers seraient perdus)", () => {
    expect(files({ VERCEL: "1" })).toEqual([expect.objectContaining({ level: "blocking", message: expect.stringContaining("S3_BUCKET manquante") })]);
  });
  it("S3_BUCKET sans clés : bloquant ; avec clés : rien à signaler", () => {
    expect(files({ S3_BUCKET: "b" }).map((p) => p.message)).toEqual(expect.arrayContaining([expect.stringContaining("S3_ACCESS_KEY_ID"), expect.stringContaining("S3_SECRET_ACCESS_KEY")]));
    expect(files({ S3_BUCKET: "b", S3_ACCESS_KEY_ID: "i", S3_SECRET_ACCESS_KEY: "s", VERCEL: "1" })).toEqual([]);
    expect(files({ S3_BUCKET: "b", S3_ACCESS_KEY_ID: "i", S3_SECRET_ACCESS_KEY: "s", S3_ENDPOINT: "ftp://x" })).toHaveLength(1);
  });
  it("serveur à disque en production : simple avertissement ; hors production : silence", () => {
    expect(files({ NODE_ENV: "production" })).toEqual([expect.objectContaining({ level: "warning" })]);
    expect(files({})).toEqual([]);
  });
});
