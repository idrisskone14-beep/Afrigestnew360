import { beforeAll, describe, expect, it } from "vitest";
import { baseClient, platformDb, tenantDb, tenantTransaction } from "@/core/db/client";
import { AppError } from "@/core/errors";
import { makeCompany } from "../helpers";

/**
 * TEST CRITIQUE : un utilisateur de la Company A ne doit jamais pouvoir consulter ou modifier
 * une ressource appartenant à la Company B — vérifié à chaque couche (scope Prisma, RLS PostgreSQL).
 */
describe("Isolation multi-tenant", () => {
  let A: Awaited<ReturnType<typeof makeCompany>>;
  let B: Awaited<ReturnType<typeof makeCompany>>;
  let branchA: string;
  let branchB: string;

  beforeAll(async () => {
    A = await makeCompany("Company A");
    B = await makeCompany("Company B");
    branchA = (await platformDb.branch.create({ data: { companyId: A.company.id, name: "Agence A" } })).id;
    branchB = (await platformDb.branch.create({ data: { companyId: B.company.id, name: "Agence B" } })).id;
  });

  describe("couche applicative (tenantDb)", () => {
    it("ne liste que les données de son entreprise", async () => {
      const rows = await tenantDb(A.company.id).branch.findMany();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.companyId === A.company.id)).toBe(true);
      expect(rows.map((r) => r.id)).toContain(branchA);
      expect(rows.map((r) => r.id)).not.toContain(branchB);
    });

    it("ne retrouve pas une ressource de B par son identifiant", async () => {
      expect(await tenantDb(A.company.id).branch.findUnique({ where: { id: branchB } })).toBeNull();
      expect(await tenantDb(A.company.id).branch.findFirst({ where: { id: branchB } })).toBeNull();
    });

    it("ne peut pas modifier ni supprimer une ressource de B", async () => {
      const db = tenantDb(A.company.id);
      await expect(db.branch.update({ where: { id: branchB }, data: { name: "piraté" } })).rejects.toThrow();
      await expect(db.branch.delete({ where: { id: branchB } })).rejects.toThrow();
      expect((await db.branch.updateMany({ where: { id: branchB }, data: { name: "piraté" } })).count).toBe(0);
      expect((await db.branch.deleteMany({ where: { id: branchB } })).count).toBe(0);
      expect((await platformDb.branch.findUniqueOrThrow({ where: { id: branchB } })).name).toBe("Agence B");
    });

    it("refuse de créer une ressource pour l'entreprise B", async () => {
      await expect(
        tenantDb(A.company.id).branch.create({ data: { companyId: B.company.id, name: "Intrus" } }),
      ).rejects.toMatchObject({ code: "TENANT_VIOLATION" });
    });

    it("refuse de déplacer une ressource vers B", async () => {
      await expect(
        tenantDb(A.company.id).branch.update({ where: { id: branchA }, data: { companyId: B.company.id } }),
      ).rejects.toBeInstanceOf(AppError);
    });

    it("estampille automatiquement l'entreprise active à la création", async () => {
      const row = await tenantDb(A.company.id).costCenter.create({
        data: { code: "CC1", name: "Centre 1" } as never,
      });
      expect(row.companyId).toBe(A.company.id);
    });

    it("isole aussi le modèle Company lui-même", async () => {
      const db = tenantDb(A.company.id);
      expect((await db.company.findMany()).map((c) => c.id)).toEqual([A.company.id]);
      await expect(db.company.findUnique({ where: { id: B.company.id } })).rejects.toBeInstanceOf(AppError);
      await expect(db.company.create({ data: { legalName: "X", slug: "x-" + Date.now() } })).rejects.toBeInstanceOf(AppError);
    });

    it("isole les memberships et rôles", async () => {
      const db = tenantDb(A.company.id);
      const members = await db.companyMembership.findMany();
      expect(members.every((m) => m.companyId === A.company.id)).toBe(true);
      const roles = await db.role.findMany();
      expect(roles.every((r) => r.companyId === A.company.id)).toBe(true);
    });
  });

  describe("transactions interactives (tenantTransaction)", () => {
    it("restent isolées, y compris en SQL brut (RLS)", async () => {
      await tenantTransaction(A.company.id, async (tx) => {
        const rows = await tx.branch.findMany();
        expect(rows.map((r) => r.id)).not.toContain(branchB);
        const raw = await tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM "Branch"`;
        expect(raw.map((r) => r.id)).toContain(branchA);
        expect(raw.map((r) => r.id)).not.toContain(branchB);
      });
    });

    it("annulent tout en cas d'erreur", async () => {
      await expect(
        tenantTransaction(A.company.id, async (tx) => {
          await tx.costCenter.create({ data: { code: "ROLLBACK", name: "x" } as never });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(await platformDb.costCenter.count({ where: { code: "ROLLBACK" } })).toBe(0);
    });
  });

  describe("couche PostgreSQL (RLS) — sans aucun filtre applicatif", () => {
    const asTenant = async <T>(companyId: string, fn: (tx: typeof baseClient) => Promise<T>) =>
      baseClient.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
        return fn(tx as unknown as typeof baseClient);
      });

    it("sans contexte : aucune ligne visible (fail-closed)", async () => {
      expect(await baseClient.branch.findMany()).toEqual([]);
      expect(await baseClient.company.findMany()).toEqual([]);
      expect(await baseClient.auditLog.findMany()).toEqual([]);
    });

    it("avec le contexte A : une requête SANS where ne voit que A", async () => {
      const rows = await asTenant(A.company.id, (tx) => tx.branch.findMany());
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.companyId === A.company.id)).toBe(true);
    });

    it("avec le contexte A : lecture directe de B par id impossible", async () => {
      const row = await asTenant(A.company.id, (tx) => tx.branch.findUnique({ where: { id: branchB } }));
      expect(row).toBeNull();
    });

    it("avec le contexte A : UPDATE/DELETE de B n'affectent aucune ligne", async () => {
      const upd = await asTenant(A.company.id, (tx) =>
        tx.branch.updateMany({ where: { id: branchB }, data: { name: "piraté" } }),
      );
      expect(upd.count).toBe(0);
      expect((await platformDb.branch.findUniqueOrThrow({ where: { id: branchB } })).name).toBe("Agence B");
      const del = await asTenant(A.company.id, (tx) => tx.branch.deleteMany({ where: { id: branchB } }));
      expect(del.count).toBe(0);
      expect(await platformDb.branch.findUnique({ where: { id: branchB } })).not.toBeNull();
    });

    it("avec le contexte A : INSERT pour B refusé par WITH CHECK", async () => {
      await expect(
        asTenant(A.company.id, (tx) => tx.branch.create({ data: { companyId: B.company.id, name: "Intrus RLS" } })),
      ).rejects.toThrow();
    });

    it("le rôle applicatif n'est ni superuser ni BYPASSRLS", async () => {
      const [r] = await baseClient.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
      expect(r).toEqual({ rolsuper: false, rolbypassrls: false });
    });
  });

  describe("journal d'audit append-only", () => {
    it("le rôle applicatif peut écrire mais pas modifier ni supprimer", async () => {
      const db = tenantDb(A.company.id);
      const log = await db.auditLog.create({
        data: { action: "test.create", resource: "Test", summary: "entrée de test" } as never,
      });
      await expect(db.auditLog.update({ where: { id: log.id }, data: { summary: "falsifié" } })).rejects.toThrow();
      await expect(db.auditLog.delete({ where: { id: log.id } })).rejects.toThrow();
      expect((await db.auditLog.findUnique({ where: { id: log.id } }))?.summary).toBe("entrée de test");
    });

    it("A ne voit pas le journal de B", async () => {
      await tenantDb(B.company.id).auditLog.create({ data: { action: "b.only", resource: "Test" } as never });
      const logsA = await tenantDb(A.company.id).auditLog.findMany();
      expect(logsA.some((l) => l.action === "b.only")).toBe(false);
    });
  });

  describe("client plateforme", () => {
    it("voit toutes les entreprises (bypass explicite)", async () => {
      const ids = (await platformDb.company.findMany()).map((c) => c.id);
      expect(ids).toContain(A.company.id);
      expect(ids).toContain(B.company.id);
    });
  });
});
