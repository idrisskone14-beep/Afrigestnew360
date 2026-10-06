import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Garde-fou de performance : toute clé étrangère simple doit être couverte par un index utile, en tête ou juste
 * après `companyId` (les requêtes applicatives filtrent toujours par entreprise). Sans cela, jointures, filtres par
 * parent et suppressions du parent font des parcours séquentiels dès que les tables grossissent.
 */
describe("hygiène de la base de données", () => {
  const client = new Client({ connectionString: process.env.DIRECT_URL });
  beforeAll(() => client.connect());
  afterAll(() => client.end());

  it("aucune clé étrangère simple sans index utile", async () => {
    const { rows } = await client.query<{ tbl: string; col: string }>(`
      SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1 AND a.attname <> 'companyId'
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.conrelid
            AND ( i.indkey[0] = c.conkey[1]
                  OR ( i.indkey[1] = c.conkey[1]
                       AND i.indkey[0] = (SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'companyId') ) )
        )
      ORDER BY 1, 2`);
    expect(rows.map((r) => `${r.tbl}.${r.col}`)).toEqual([]);
  });

  it("la table de compteurs du limiteur n'est pas soumise à la RLS (elle n'a pas d'entreprise)", async () => {
    const { rows } = await client.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'RateLimitBucket'`);
    expect(rows[0]).toEqual({ relrowsecurity: false });
  });
});
