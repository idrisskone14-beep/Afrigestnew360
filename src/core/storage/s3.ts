import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { StorageProvider } from "./index";

/** Réglages d'un stockage compatible S3 : Amazon S3, Cloudflare R2, Scaleway, Backblaze B2, Supabase Storage, MinIO… */
export interface S3Config {
  bucket: string;
  /** Région (« auto » pour Cloudflare R2). */
  region: string;
  /** Point d'accès du fournisseur ; vide pour Amazon S3. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Adressage « chemin » (https://hôte/bucket/clé) exigé par MinIO et certains fournisseurs. */
  forcePathStyle?: boolean;
  /** Dossier racine dans le bucket (permet de partager un bucket entre plusieurs environnements). */
  prefix?: string;
}

/** Sous-ensemble du client S3 utilisé ici : permet de tester sans réseau. */
export interface S3Like { send(command: unknown): Promise<unknown> }

export function s3ConfigFromEnv(env: Record<string, string | undefined> = process.env): S3Config | null {
  if (!env.S3_BUCKET) return null;
  return {
    bucket: env.S3_BUCKET,
    region: env.S3_REGION || "auto",
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    ...(env.S3_KEY_PREFIX ? { prefix: env.S3_KEY_PREFIX } : {}),
  };
}

const isMissing = (e: unknown) => {
  const err = e as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === "NoSuchKey" || err?.Code === "NoSuchKey" || err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404;
};

/**
 * Stockage S3-compatible. Les clés (`<companyId>/…`) sont validées par `storage` (index.ts) avant d'arriver ici, avec la même règle que le disque ;
 * le fichier n'est jamais servi directement depuis le bucket : l'application contrôle l'accès à chaque lecture. Bucket PRIVÉ requis.
 */
export function createS3Storage(cfg: S3Config, client?: S3Like): StorageProvider {
  const s3: S3Like = client ?? new S3Client({
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    forcePathStyle: cfg.forcePathStyle ?? false,
    // sommes de contrôle « seulement si exigées » : plusieurs fournisseurs S3-compatibles (anciens MinIO, Backblaze, Scaleway…) refusent celles que le SDK ajoute par défaut
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  const objectKey = (key: string) => (cfg.prefix ? `${cfg.prefix.replace(/^\/+|\/+$/g, "")}/${key}` : key);
  return {
    async put(key, data) {
      await s3.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: objectKey(key), Body: data, ContentType: "application/octet-stream" }));
    },
    async get(key) {
      try {
        const res = (await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: objectKey(key) }))) as { Body?: { transformToByteArray(): Promise<Uint8Array> } };
        return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null;
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: objectKey(key) })); // supprimer une clé absente n'est pas une erreur en S3
    },
  };
}
