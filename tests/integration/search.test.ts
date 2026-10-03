import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs"), os = process.getBuiltinModule("node:os"), path = process.getBuiltinModule("node:path");
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "afg-search-"));
});

import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { customerSchema } from "@/modules/crm/schemas";
import * as crm from "@/modules/crm/service";
import { documentMetaSchema } from "@/modules/documents/schemas";
import * as docs from "@/modules/documents/service";
import * as emp from "@/modules/hr/employees";
import { employeeSchema } from "@/modules/hr/schemas";
import { setCompanyModule } from "@/modules/platform/companies";
import { projectSchema } from "@/modules/projects/schemas";
import * as pj from "@/modules/projects/service";
import { globalSearch, searchableTypes } from "@/modules/search/service";
import { addMember, ctxFor, makeCompany } from "../helpers";

const PDF = Buffer.from("%PDF-1.4\n%%EOF");

async function setup() {
  const co = await makeCompany("SRCH", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  return { ...co, ctx: await ctxFor(co.owner.id, co.company.id) };
}
const flat = (g: Awaited<ReturnType<typeof globalSearch>>) => g.flatMap((x) => x.items.map((i) => `${x.type}:${i.label}`));

describe("recherche globale", () => {
  it("trouve clients, salariés, projets et documents ; moins de 2 caractères = rien", async () => {
    const s = await setup();
    await crm.createCustomer(s.ctx, customerSchema.parse({ type: "COMPANY", name: "Zébulon Distribution", paymentTermsDays: 30 }));
    await emp.createEmployee(s.ctx, employeeSchema.parse({ firstName: "Zélie", lastName: "Konaté", hireDate: "2022-01-03", baseSalary: 300000 }));
    await pj.createProject(s.ctx, projectSchema.parse({ name: "Chantier Zéphyr", status: "ACTIVE" }));
    await docs.createDocument(s.ctx, documentMetaSchema.parse({ name: "Zonage communal" }), { name: "z.pdf", size: PDF.length }, PDF);
    const out = flat(await globalSearch(s.ctx, "zé"));
    expect(out).toEqual(expect.arrayContaining(["customer:Zébulon Distribution", "employee:Konaté Zélie", "project:Chantier Zéphyr"]));
    expect(flat(await globalSearch(s.ctx, "zon"))).toContain("document:Zonage communal");
    expect(await globalSearch(s.ctx, "z")).toEqual([]);
    expect(await globalSearch(s.ctx, "   ")).toEqual([]);
  });

  it("isolation : jamais de résultat d'une autre entreprise", async () => {
    const a = await setup();
    const b = await setup();
    await crm.createCustomer(a.ctx, customerSchema.parse({ type: "COMPANY", name: "Secret Client A", paymentTermsDays: 30 }));
    await docs.createDocument(a.ctx, documentMetaSchema.parse({ name: "Secret document A" }), { name: "a.pdf", size: PDF.length }, PDF);
    expect(flat(await globalSearch(b.ctx, "secret"))).toEqual([]);
    expect(flat(await globalSearch(a.ctx, "secret")).length).toBe(2);
  });

  it("respecte les permissions : un rôle sans droit RH ne voit pas les salariés", async () => {
    const s = await setup();
    await emp.createEmployee(s.ctx, employeeSchema.parse({ firstName: "Yacouba", lastName: "Traoré", hireDate: "2022-01-03", baseSalary: 300000 }));
    await crm.createCustomer(s.ctx, customerSchema.parse({ type: "COMPANY", name: "Yacouba & Fils", paymentTermsDays: 30 }));
    const rep = await ctxFor((await addMember(s.company.id, "sales_rep")).user.id, s.company.id);
    const out = flat(await globalSearch(rep, "yacouba"));
    expect(out).toContain("customer:Yacouba & Fils");
    expect(out.some((x) => x.startsWith("employee:"))).toBe(false);
    expect(searchableTypes(rep).map((t) => t.type)).not.toContain("employee");
    const employee = await ctxFor((await addMember(s.company.id, "employee")).user.id, s.company.id);
    expect(flat(await globalSearch(employee, "yacouba"))).toEqual([]);
  });

  it("module désactivé : ses résultats disparaissent", async () => {
    const s = await setup();
    await crm.createCustomer(s.ctx, customerSchema.parse({ type: "COMPANY", name: "Kouassi Matériaux", paymentTermsDays: 30 }));
    expect(flat(await globalSearch(s.ctx, "kouassi")).length).toBe(1);
    await setCompanyModule(s.company.id, "crm", false);
    const ctx = await ctxFor(s.owner.id, s.company.id);
    expect(flat(await globalSearch(ctx, "kouassi"))).toEqual([]);
    expect(searchableTypes(ctx).map((t) => t.type)).not.toContain("customer");
  });

  it("documents : un document restreint ou lié à un salarié reste invisible à qui n'y a pas droit", async () => {
    const s = await setup();
    const hr = await ctxFor((await addMember(s.company.id, "hr")).user.id, s.company.id);
    const pm = await ctxFor((await addMember(s.company.id, "project_manager")).user.id, s.company.id);
    await docs.createDocument(hr, documentMetaSchema.parse({ name: "Sanction Omega", visibility: "RESTRICTED" }), { name: "o.pdf", size: PDF.length }, PDF);
    await docs.createDocument(hr, documentMetaSchema.parse({ name: "Note Omega publique" }), { name: "n.pdf", size: PDF.length }, PDF);
    expect(flat(await globalSearch(pm, "omega"))).toEqual(["document:Note Omega publique"]);
    expect(flat(await globalSearch(hr, "omega")).length).toBe(2);
  });

  it("au plus 5 résultats par type ; caractères spéciaux traités comme du texte", async () => {
    const s = await setup();
    for (let i = 0; i < 8; i++) await crm.createCustomer(s.ctx, customerSchema.parse({ type: "COMPANY", name: `Lot Client ${i}`, paymentTermsDays: 30 }));
    const g = await globalSearch(s.ctx, "lot client");
    expect(g.find((x) => x.type === "customer")!.items).toHaveLength(5);
    await expect(globalSearch(s.ctx, "%_\\'\";--")).resolves.toEqual([]);
  });
});
