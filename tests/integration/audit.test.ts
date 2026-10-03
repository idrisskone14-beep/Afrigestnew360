import { describe, expect, it } from "vitest";
import { audit } from "@/core/audit";
import { parseAuditFilters } from "@/modules/audit/params";
import { auditFacets, auditForExport, listAudit } from "@/modules/audit/service";
import { EXPORTERS } from "@/modules/data/exports";
import { addMember, ctxFor, makeCompany } from "../helpers";

async function setup() {
  const co = await makeCompany("AUD", "enterprise");
  return { ...co, ctx: await ctxFor(co.owner.id, co.company.id) };
}
const log = (ctx: Awaited<ReturnType<typeof ctxFor>>, action: string, resource: string, summary: string, extra: Record<string, unknown> = {}) =>
  audit(ctx, { action, resource, resourceId: "00000000-0000-4000-8000-000000000001", summary, ...extra });

describe("journal d'audit", () => {
  it("isolation : une entreprise ne voit jamais le journal d'une autre", async () => {
    const a = await setup();
    const b = await setup();
    await log(a.ctx, "invoice.update", "Invoice", "A a modifié la facture FAC-A");
    await log(b.ctx, "invoice.update", "Invoice", "B a modifié la facture FAC-B");
    const ra = await listAudit(a.ctx, {}, { skip: 0, take: 50 });
    expect(ra.rows.every((r) => !r.summary?.includes("FAC-B"))).toBe(true);
    expect(ra.rows.some((r) => r.summary?.includes("FAC-A"))).toBe(true);
    const rb = await listAudit(b.ctx, { q: "FAC-A" }, { skip: 0, take: 50 });
    expect(rb.total).toBe(0);
    expect((await auditForExport(b.ctx, {})).some((r) => r.summary?.includes("FAC-A"))).toBe(false);
    expect((await auditFacets(b.ctx)).users.map((u) => u.id)).not.toContain(a.owner.id);
  });

  it("filtres : texte, ressource, préfixe d'action, utilisateur, période", async () => {
    const s = await setup();
    const other = await addMember(s.company.id, "admin");
    const octx = await ctxFor(other.user.id, s.company.id);
    await log(s.ctx, "invoice.update", "Invoice", "Modification facture FAC-1");
    await log(s.ctx, "hr.employee.create", "Employee", "Création du salarié EMP-1");
    await log(octx, "invoice.cancel", "Invoice", "Annulation facture FAC-2");
    const q = (f: Parameters<typeof listAudit>[1]) => listAudit(s.ctx, f, { skip: 0, take: 50 }).then((r) => r.rows.map((x) => x.summary));
    expect(await q({ q: "salarié" })).toEqual(["Création du salarié EMP-1"]);
    expect((await q({ resource: "Invoice" })).length).toBe(2);
    expect(await q({ action: "hr." })).toEqual(["Création du salarié EMP-1"]);
    expect(await q({ userId: other.user.id })).toEqual(["Annulation facture FAC-2"]);
    expect(await q({ from: new Date(Date.now() + 86_400_000) })).toEqual([]);
    expect((await q({ to: new Date(Date.now() + 86_400_000) })).length).toBe(3);
    const facets = await auditFacets(s.ctx);
    expect(facets.resources).toEqual(expect.arrayContaining(["Employee", "Invoice"]));
  });

  it("valeurs avant/après conservées ; champs sensibles masqués", async () => {
    const s = await setup();
    await log(s.ctx, "customer.update", "Customer", "Mise à jour client", { before: { name: "Ancien", passwordHash: "x" }, after: { name: "Nouveau", token: "abc" } });
    const row = (await listAudit(s.ctx, { action: "customer." }, { skip: 0, take: 5 })).rows[0]!;
    expect(row.before).toEqual({ name: "Ancien", passwordHash: "[masqué]" });
    expect(row.after).toEqual({ name: "Nouveau", token: "[masqué]" });
  });

  it("réservé à ceux qui détiennent audit.log.read", async () => {
    const s = await setup();
    const employee = await ctxFor((await addMember(s.company.id, "employee")).user.id, s.company.id);
    const viewer = await ctxFor((await addMember(s.company.id, "viewer")).user.id, s.company.id);
    await expect(listAudit(employee, {}, { skip: 0, take: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(auditForExport(employee, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listAudit(viewer, {}, { skip: 0, take: 5 })).resolves.toBeTruthy();
    expect(EXPORTERS.audit!.permissions).toEqual(["audit.log.read"]);
  });

  it("le journal est en écriture seule : aucune modification ni suppression possible par l'application", async () => {
    const s = await setup();
    await log(s.ctx, "x.test", "Test", "Entrée de test");
    await expect(s.ctx.tx((tx) => tx.$executeRaw`UPDATE "AuditLog" SET "summary" = 'falsifié'`)).rejects.toThrow();
    await expect(s.ctx.tx((tx) => tx.$executeRaw`DELETE FROM "AuditLog"`)).rejects.toThrow();
    expect((await listAudit(s.ctx, { q: "falsifié" }, { skip: 0, take: 5 })).total).toBe(0);
  });

  it("filtres d'URL : valeurs invalides ignorées, date de fin inclusive", () => {
    const f = parseAuditFilters((k) => ({ utilisateur: "pas-un-uuid", ressource: "Inv;DROP", action: "Inv ice", du: "2026-13-45", au: "2026-10-03", q: "  FAC  " })[k]);
    expect(f.userId).toBeUndefined();
    expect(f.resource).toBeUndefined();
    expect(f.action).toBeUndefined();
    expect(f.from).toBeUndefined();
    expect(f.to?.toISOString()).toBe("2026-10-04T00:00:00.000Z");
    expect(f.q).toBe("FAC");
  });

  it("l'export reprend les mêmes filtres que l'écran", async () => {
    const s = await setup();
    await log(s.ctx, "invoice.update", "Invoice", "Facture FAC-9");
    await log(s.ctx, "hr.employee.create", "Employee", "Salarié EMP-9");
    const t = await EXPORTERS.audit!.build(s.ctx, (k) => ({ ressource: "Invoice" })[k]);
    expect(t.title).toBe("Journal d'audit");
    expect(t.rows.map((r) => r.summary)).toEqual(["Facture FAC-9"]);
  });
});
