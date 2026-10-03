import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TENANT_KEY } from "@/core/db/tenant-models";

/**
 * Garde-fou : toute table portant `companyId` DOIT avoir la RLS activée ET forcée,
 * et être déclarée dans TENANT_KEY (sinon le filtre applicatif ne la couvrirait pas).
 */
describe("Couverture RLS", () => {
  const client = new Client({ connectionString: process.env.DIRECT_URL });
  beforeAll(() => client.connect());
  afterAll(() => client.end());

  it("toutes les tables à companyId ont la RLS activée et forcée", async () => {
    const { rows } = await client.query<{ table_name: string; rls: boolean; forced: boolean }>(`
      SELECT c.table_name, cl.relrowsecurity AS rls, cl.relforcerowsecurity AS forced
      FROM information_schema.columns c
      JOIN pg_class cl ON cl.relname = c.table_name AND cl.relnamespace = 'public'::regnamespace
      WHERE c.table_schema = 'public' AND c.column_name = 'companyId'`);
    expect(rows.length).toBeGreaterThan(5);
    const missing = rows.filter((r) => !r.rls || !r.forced).map((r) => r.table_name);
    expect(missing).toEqual([]);
  });

  it("Company est protégée par RLS (colonne id)", async () => {
    const { rows } = await client.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'Company'`);
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("chaque modèle Prisma avec companyId est déclaré dans TENANT_KEY (et inversement)", () => {
    const dir = path.resolve(process.cwd(), "prisma/schema");
    const schema = readdirSync(dir).filter((f) => f.endsWith(".prisma")).map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");
    const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
    const withCompanyId = models.filter((m) => /^\s*companyId\s/m.test(m[2]!)).map((m) => m[1]!);
    const declared = Object.entries(TENANT_KEY).filter(([, k]) => k === "companyId").map(([n]) => n);
    expect(withCompanyId.sort()).toEqual(declared.sort());
  });

  it("le journal d'audit est append-only pour le rôle applicatif", async () => {
    const { rows } = await client.query<{ priv: string; ok: boolean }>(`
      SELECT p AS priv, has_table_privilege('afrigest_app', '"AuditLog"', p) AS ok
      FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) AS p`);
    const map = Object.fromEntries(rows.map((r) => [r.priv, r.ok]));
    expect(map).toMatchObject({ SELECT: true, INSERT: true, UPDATE: false, DELETE: false, TRUNCATE: false });
  });
});
