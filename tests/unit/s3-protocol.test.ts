import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import S3rver from "s3rver";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createS3Storage } from "@/core/storage/s3";

/**
 * Vrai protocole S3 (requêtes signées via HTTP) contre un serveur compatible S3 local : vérifie que la configuration du client
 * (point d'accès, adressage « chemin », région « auto », identifiants) fonctionne réellement, ce que le faux client en mémoire ne prouve pas.
 */
const COMPANY = "11111111-1111-4111-8111-111111111111";
const free = () => new Promise<number>((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); }); });

describe("stockage S3 : protocole réel", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "afg-s3rver-"));
  let server: S3rver;
  let endpoint = "";

  beforeAll(async () => {
    const port = await free();
    server = new S3rver({ port, address: "127.0.0.1", silent: true, directory: dir, configureBuckets: [{ name: "kako", configs: [] }] });
    await server.run();
    endpoint = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const cfg = () => ({ bucket: "kako", region: "auto", endpoint, accessKeyId: "S3RVER", secretAccessKey: "S3RVER", forcePathStyle: true });

  it("écrit, relit (octets identiques), supprime ; une clé absente → null", async () => {
    const s = createS3Storage(cfg());
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255, 254]);
    await s.put(`${COMPANY}/logo.png`, data);
    expect((await s.get(`${COMPANY}/logo.png`))?.equals(data)).toBe(true);
    await s.delete(`${COMPANY}/logo.png`);
    expect(await s.get(`${COMPANY}/logo.png`)).toBeNull();
    expect(await s.get(`${COMPANY}/jamais-ecrit.pdf`)).toBeNull();
  });

  it("fichier de plusieurs Mo, préfixe de dossier", async () => {
    const s = createS3Storage({ ...cfg(), prefix: "prod" });
    const big = Buffer.alloc(3 * 1024 * 1024, 7);
    await s.put(`${COMPANY}/doc.pdf`, big);
    expect((await s.get(`${COMPANY}/doc.pdf`))?.length).toBe(big.length);
    // le préfixe isole les environnements : sans préfixe, la même clé n'existe pas
    expect(await createS3Storage(cfg()).get(`${COMPANY}/doc.pdf`)).toBeNull();
  });
});
