import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { BACKUP_ROLE, ensureBackupRole } from "../../scripts/db-backup-role";
import { makeCompany } from "../helpers";

const PASSWORD = "test-backup-password-0123456789";

const urlFor = (user: string, password: string) => {
  const u = new URL(process.env.DIRECT_URL!);
  u.username = user;
  u.password = password;
  return u.toString();
};

describe("compte de sauvegarde en lecture seule", () => {
  const opened: Client[] = [];
  const connectAsBackup = async (password = PASSWORD) => {
    const c = new Client({ connectionString: urlFor(BACKUP_ROLE, password) });
    await c.connect();
    opened.push(c);
    return c;
  };
  afterAll(async () => { await Promise.all(opened.map((c) => c.end().catch(() => undefined))); });

  const asOwner = async <T>(fn: (c: Client) => Promise<T>) => {
    const c = new Client({ connectionString: process.env.DIRECT_URL });
    await c.connect();
    try { return await fn(c); } finally { await c.end(); }
  };

  it("lit toutes les lignes avec app.bypass_rls (comme la sauvegarde) mais rien sans lui ; aucun droit d'écriture", async () => {
    await makeCompany("SAUVEGARDE");
    await asOwner((c) => ensureBackupRole(c, PASSWORD));
    const b = await connectAsBackup();

    // l'isolation entre entreprises s'applique au compte de sauvegarde : sans le réglage, il ne voit rien
    expect(Number((await b.query('select count(*) as n from "Company"')).rows[0].n)).toBe(0);
    await b.query("set app.bypass_rls = 'on'");
    expect(Number((await b.query('select count(*) as n from "Company"')).rows[0].n)).toBeGreaterThan(0);
    expect(Number((await b.query('select count(*) as n from "_prisma_migrations"')).rows[0].n)).toBeGreaterThan(0);

    // lecture seule : toute écriture est refusée (42501 = permission refusée)
    await expect(b.query('delete from "Company"')).rejects.toMatchObject({ code: "42501" });
    await expect(b.query('update "Plan" set name = name')).rejects.toMatchObject({ code: "42501" });
    await expect(b.query('insert into "Plan" (id) values (gen_random_uuid())')).rejects.toMatchObject({ code: "42501" });
    await expect(b.query('drop table "Company"')).rejects.toMatchObject({ code: "42501" });
  });

  it("n'est ni superutilisateur ni BYPASSRLS, et limité à deux connexions", async () => {
    const r = await asOwner((c) => c.query("select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolconnlimit from pg_roles where rolname = $1", [BACKUP_ROLE]));
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolconnlimit: 2 });
  });

  it("idempotent : relancé, il change le mot de passe ; les tables créées ensuite sont lisibles sans relancer", async () => {
    const next = "another-backup-password-9876543210";
    await asOwner((c) => ensureBackupRole(c, next));
    await expect(connectAsBackup(PASSWORD)).rejects.toThrow();
    const b = await connectAsBackup(next);
    await asOwner(async (c) => { await c.query("drop table if exists bk_probe"); await c.query("create table bk_probe (id int)"); });
    try {
      expect((await b.query("select count(*) as n from bk_probe")).rows[0].n).toBe("0");
    } finally {
      await asOwner((c) => c.query("drop table if exists bk_probe"));
    }
  });

  it("refuse un mot de passe trop court", async () => {
    await expect(asOwner((c) => ensureBackupRole(c, "court"))).rejects.toThrow(/20 caractères/);
  });
});
