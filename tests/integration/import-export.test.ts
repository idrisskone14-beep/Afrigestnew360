import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { renderExport } from "@/core/export/table";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import * as emp from "@/modules/hr/employees";
import * as inv from "@/modules/inventory/service";
import { ENTITIES, fieldsFor, suggestMapping } from "@/modules/data/entities";
import { EXPORTERS } from "@/modules/data/exports";
import { analyzeImport, discardImport, importReport, listImports, previewImport, runImport } from "@/modules/data/import-service";
import { setCompanyModule } from "@/modules/platform/companies";
import { addMember, ctxFor, makeCompany, makeUser } from "../helpers";

async function setup() {
  const co = await makeCompany("IMP", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  return { ...co, ctx: await ctxFor(co.owner.id, co.company.id) };
}
type S = Awaited<ReturnType<typeof setup>>;

/** Membre dont le rôle ne détient QUE les permissions données. */
async function memberWith(s: S, permissions: string[]) {
  const user = await makeUser();
  const role = await platformDb.role.create({ data: { companyId: s.company.id, name: `Rôle ${Math.random().toString(36).slice(2, 8)}` } });
  const perms = await platformDb.permission.findMany({ where: { key: { in: permissions } } });
  await platformDb.rolePermission.createMany({ data: perms.map((p) => ({ companyId: s.company.id, roleId: role.id, permissionId: p.id })) });
  await platformDb.companyMembership.create({ data: { userId: user.id, companyId: s.company.id, roleId: role.id } });
  return { user, ctx: await ctxFor(user.id, s.company.id) };
}

const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(";")).join("\n"), "utf8");
const upload = (ctx: S["ctx"], entity: string, rows: string[][], name = "import.csv") => analyzeImport(ctx, entity, { name, size: 1 }, csv(rows));
const run = async (ctx: S["ctx"], entity: string, rows: string[][], mapping?: Record<string, number>) => {
  const a = await upload(ctx, entity, rows);
  const p = await previewImport(ctx, a.id, mapping ?? a.suggested);
  return { a, p };
};

const CUSTOMER_HEADER = ["Raison sociale", "Type", "E-mail", "Téléphone", "Ville", "Pays", "Délai de paiement", "Plafond de crédit"];

describe("import de clients", () => {
  it("analyse, correspondance automatique, vérification ligne par ligne, import par les services (numérotation, audit)", async () => {
    const s = await setup();
    const rows = [CUSTOMER_HEADER,
      ["Quincaillerie Koffi", "Entreprise", "koffi@exemple.ci", "+225 07 00 00 00 00", "Abidjan", "Côte d'Ivoire", "45", "1 500 000"],
      ["Awa Traoré", "Particulier", "", "", "Bouaké", "CI", "", ""],
      ["", "Entreprise", "sans-nom@exemple.ci", "", "", "", "", ""], // nom manquant
      ["Client E-mail Faux", "Entreprise", "pas-un-email", "", "", "", "", ""],
      ["Client Pays Inconnu", "Entreprise", "", "", "", "Atlantide", "", ""],
      ["Client Délai Faux", "Entreprise", "", "", "", "", "trente", ""],
      ["Quincaillerie Koffi bis", "Entreprise", "koffi@exemple.ci", "", "", "", "", ""], // même e-mail dans le fichier
    ];
    const a = await upload(s.ctx, "customers", rows);
    expect(a.rowCount).toBe(7);
    expect(a.suggested).toMatchObject({ name: 0, type: 1, email: 2, phone: 3, city: 4, country: 5, paymentTermsDays: 6, creditLimit: 7 }); // reconnues sans accents
    const p = await previewImport(s.ctx, a.id, a.suggested);
    expect(p).toMatchObject({ valid: 2, errors: 5, ignored: 0, total: 7 });
    const byLine = new Map(p.preview.map((r) => [r.line, r]));
    expect(byLine.get(2)).toMatchObject({ status: "ok" });
    expect(byLine.get(4)!.messages.join(" ")).toContain("Nom");
    expect(byLine.get(5)!.messages.join(" ")).toContain("E-mail");
    expect(byLine.get(6)!.messages.join(" ")).toContain("Atlantide");
    expect(byLine.get(7)!.messages.join(" ")).toContain("Délai");
    expect(byLine.get(8)!.messages.join(" ")).toContain("Doublon dans le fichier (identique à la ligne 2)");
    expect(await s.ctx.db.customer.count()).toBe(0); // la prévisualisation n'écrit rien

    const res = await runImport(s.ctx, a.id);
    expect(res).toMatchObject({ created: 2, errors: 5, failed: 0 });
    const customers = await s.ctx.db.customer.findMany({ orderBy: { code: "asc" } });
    expect(customers.map((c) => [c.code, c.name, c.type, c.country, c.paymentTermsDays, c.creditLimit ? Number(c.creditLimit) : null])).toEqual([
      ["CLI-00001", "Quincaillerie Koffi", "COMPANY", "CI", 45, 1500000], ["CLI-00002", "Awa Traoré", "INDIVIDUAL", "CI", 30, null],
    ]);
    expect(await s.ctx.db.auditLog.count({ where: { action: "customer.create" } })).toBe(2);
    expect(await s.ctx.db.auditLog.count({ where: { action: "import.run" } })).toBe(1);

    // le fichier brut est purgé ; le rapport garde les anomalies avec les valeurs d'origine pour correction
    const job = await s.ctx.db.importJob.findFirstOrThrow({ where: { id: a.id } });
    expect(job).toMatchObject({ status: "DONE", rows: null, createdCount: 2, errorCount: 5 });
    const { entries } = await importReport(s.ctx, a.id);
    expect(entries).toHaveLength(5);
    expect(entries.find((e) => e.line === 4)).toMatchObject({ kind: "error", values: ["", "Entreprise", "sans-nom@exemple.ci", "", "", "", "", ""] });
  });

  it("rejouer le même fichier : tout est ignoré (aucun doublon) ; l'import ne se lance qu'une fois", async () => {
    const s = await setup();
    const rows = [["Nom", "E-mail"], ["Alpha SARL", "a@exemple.ci"], ["Bêta SA", ""]];
    const first = await run(s.ctx, "customers", rows);
    await Promise.all([runImport(s.ctx, first.a.id), runImport(s.ctx, first.a.id)].map((p) => p.catch((e) => e))); // lancement simultané
    expect(await s.ctx.db.customer.count()).toBe(2); // une seule exécution a eu lieu
    await expect(runImport(s.ctx, first.a.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const again = await run(s.ctx, "customers", rows);
    expect(again.p).toMatchObject({ valid: 0, ignored: 2, errors: 0 });
    expect(await runImport(s.ctx, again.a.id)).toMatchObject({ created: 0, ignored: 2 });
    expect(await s.ctx.db.customer.count()).toBe(2);
    // les données ont pu changer entre la vérification et l'import : relues au dernier moment
    const late = await run(s.ctx, "customers", [["Nom"], ["Retardataire SARL"]]);
    await run(s.ctx, "customers", [["Nom"], ["Retardataire SARL"]]).then((x) => runImport(s.ctx, x.a.id)); // quelqu'un l'importe entre-temps
    expect(await runImport(s.ctx, late.a.id)).toMatchObject({ created: 0, ignored: 1 });
    expect(await s.ctx.db.customer.count({ where: { name: "Retardataire SARL" } })).toBe(1);
  });

  it("correspondance : champs obligatoires, colonnes inconnues ou en double refusés ; état du travail", async () => {
    const s = await setup();
    const a = await upload(s.ctx, "customers", [["Nom", "E-mail"], ["Alpha", "a@exemple.ci"]]);
    await expect(previewImport(s.ctx, a.id, {})).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("obligatoire") });
    await expect(previewImport(s.ctx, a.id, { name: 0, email: 0 })).rejects.toMatchObject({ message: expect.stringContaining("même colonne") });
    await expect(previewImport(s.ctx, a.id, { name: 7 })).rejects.toMatchObject({ message: expect.stringContaining("inexistante") });
    await expect(previewImport(s.ctx, a.id, { name: 0, hack: 1 })).rejects.toMatchObject({ message: expect.stringContaining("Champ inconnu") });
    await expect(runImport(s.ctx, a.id)).rejects.toMatchObject({ message: expect.stringContaining("Prévisualisez") });
    await previewImport(s.ctx, a.id, { name: 0 }); // on peut revenir corriger la correspondance
    await previewImport(s.ctx, a.id, { name: 0, email: 1 });
    await runImport(s.ctx, a.id);
    await expect(previewImport(s.ctx, a.id, { name: 0 })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect((await listImports(s.ctx))[0]).toMatchObject({ status: "DONE", createdCount: 1 });
    await discardImport(s.ctx, a.id);
    expect(await listImports(s.ctx)).toHaveLength(0);
    expect(await s.ctx.db.customer.count()).toBe(1); // supprimer l'historique ne touche pas aux données importées
  });

  it("Excel (.xlsx) : mêmes règles que le CSV", async () => {
    const s = await setup();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Clients");
    ws.addRow(["Nom", "Ville", "Délai de paiement"]);
    ws.addRow(["Société Excel", "Dakar", 60]);
    const a = await analyzeImport(s.ctx, "customers", { name: "clients.xlsx", size: 1 }, Buffer.from(await wb.xlsx.writeBuffer()));
    await previewImport(s.ctx, a.id, a.suggested);
    await runImport(s.ctx, a.id);
    expect(await s.ctx.db.customer.findFirstOrThrow({ where: { name: "Société Excel" } })).toMatchObject({ city: "Dakar", paymentTermsDays: 60 });
  });
});

describe("isolation et droits", () => {
  it("une entreprise ne voit ni ne pilote les imports d'une autre ; les données importées lui restent propres", async () => {
    const a = await setup(), b = await setup();
    const ja = await upload(a.ctx, "customers", [["Nom"], ["Secret SARL"]]);
    await expect(previewImport(b.ctx, ja.id, { name: 0 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(runImport(b.ctx, ja.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(importReport(b.ctx, ja.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(discardImport(b.ctx, ja.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listImports(b.ctx)).toHaveLength(0);
    await previewImport(a.ctx, ja.id, { name: 0 });
    await runImport(a.ctx, ja.id);
    expect(await b.ctx.db.customer.count()).toBe(0);
    // un client de A n'est pas « déjà présent » pour B : B peut avoir le même nom
    const jb = await run(b.ctx, "customers", [["Nom"], ["Secret SARL"]]);
    expect(jb.p).toMatchObject({ valid: 1, ignored: 0 });
  });

  it("droit d'import + droit de création de l'élément + module actif ; refus par défaut", async () => {
    const s = await setup();
    const rep = await ctxFor((await addMember(s.company.id, "sales_rep")).user.id, s.company.id); // peut créer des clients, pas importer
    await expect(upload(rep, "customers", [["Nom"], ["X"]])).rejects.toMatchObject({ code: "FORBIDDEN" });
    const onlyImport = await memberWith(s, ["data.import.manage"]);
    await expect(upload(onlyImport.ctx, "customers", [["Nom"], ["X"]])).rejects.toMatchObject({ code: "FORBIDDEN" }); // ne peut pas créer des clients
    const importer = await memberWith(s, ["data.import.manage", "crm.customer.create"]);
    await expect(upload(importer.ctx, "customers", [["Nom"], ["Légitime SARL"]])).resolves.toBeTruthy();
    await expect(upload(importer.ctx, "suppliers", [["Nom"], ["X"]])).rejects.toMatchObject({ code: "FORBIDDEN" }); // autre type de données
    await expect(upload(s.ctx, "inconnu", [["Nom"], ["X"]])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await setCompanyModule(s.company.id, "crm", false);
    await expect(upload(await ctxFor(s.owner.id, s.company.id), "customers", [["Nom"], ["X"]])).rejects.toMatchObject({ code: expect.stringMatching(/MODULE|FORBIDDEN/) });
  });
});

describe("autres types de données", () => {
  it("salariés : département connu exigé, salaire et pièce d'identité réservés aux profils habilités", async () => {
    const s = await setup();
    const dep = await s.ctx.db.department.create({ data: { companyId: s.company.id, name: "Comptabilité" } });
    const rows = [["Prénom", "Nom", "Date d'embauche", "Département", "Salaire de base", "Pièce d'identité", "Mode de paiement"],
      ["Awa", "Koné", "06/01/2024", "comptabilité", "450 000", "CI0012345", "Mobile money"],
      ["Moussa", "Diallo", "2024-02-01", "Département fantôme", "300000", "", ""],
      ["Fanta", "Sylla", "31/02/2024", "", "", "", ""]];
    const { a, p } = await run(s.ctx, "employees", rows);
    expect(p).toMatchObject({ valid: 1, errors: 2 });
    expect(p.preview[1]!.messages.join(" ")).toContain("Département « Département fantôme » introuvable");
    expect(p.preview[2]!.messages.join(" ")).toContain("date invalide");
    await runImport(s.ctx, a.id);
    const awa = await s.ctx.db.employee.findFirstOrThrow({ where: { firstName: "Awa" } });
    expect(awa).toMatchObject({ number: "EMP-0001", departmentId: dep.id, payoutMethod: "MOBILE_MONEY", nationalId: "CI0012345" });
    expect(Number(awa.baseSalary)).toBe(450000);

    // RH sans droit « salaires » : champs sensibles non proposés, valeurs ignorées
    const limited = await memberWith(s, ["data.import.manage", "hr.employee.create", "hr.employee.read"]);
    expect(fieldsFor(limited.ctx, ENTITIES.employees).map((f) => f.key)).not.toContain("baseSalary");
    expect(fieldsFor(s.ctx, ENTITIES.employees).map((f) => f.key)).toContain("baseSalary");
    const r2 = await run(limited.ctx, "employees", [rows[0]!, ["Zoé", "Bah", "01/03/2024", "", "999999", "XYZ", ""]]);
    expect(r2.a.fields.map((f) => f.key)).not.toContain("nationalId");
    await expect(previewImport(limited.ctx, r2.a.id, { ...r2.a.suggested, baseSalary: 4 })).rejects.toMatchObject({ message: expect.stringContaining("Champ inconnu") });
    await runImport(limited.ctx, r2.a.id);
    const zoe = await s.ctx.db.employee.findFirstOrThrow({ where: { firstName: "Zoé" } });
    expect(Number(zoe.baseSalary)).toBe(0);
    expect(zoe.nationalId).toBeNull();
  });

  it("produits puis stocks : catégorie inconnue refusée, référence automatique, quantités comptées appliquées", async () => {
    const s = await setup();
    await inv.createCategory(s.ctx, { name: "Matériaux" } as never);
    const wh = (await inv.listWarehouses(s.ctx))[0]!;
    const prod = await run(s.ctx, "products", [["Désignation", "Référence", "Type", "Catégorie", "Unité", "Prix de vente", "Coût d'achat", "Seuil minimum de stock"],
      ["Ciment 50 kg", "CIM-50", "Bien", "Matériaux", "sac", "6 500", "5 100", "100"],
      ["Sable", "", "Bien", "Matériaux", "m³", "9000", "6500", ""], // référence automatique
      ["Conseil", "SRV-1", "Service", "", "h", "25000", "0", ""],
      ["Fer", "FER-10", "Bien", "Inexistante", "barre", "7200", "5800", ""]]);
    expect(prod.p).toMatchObject({ valid: 3, errors: 1 });
    await runImport(s.ctx, prod.a.id);
    const products = await s.ctx.db.product.findMany({ orderBy: { createdAt: "asc" } });
    expect(products.map((x) => [x.sku, x.type, x.trackStock])).toEqual([["CIM-50", "GOODS", true], ["PRD-00001", "GOODS", true], ["SRV-1", "SERVICE", false]]);
    expect(Number(products[0]!.salePrice)).toBe(6500);

    const stock = await run(s.ctx, "stock", [["Référence", "Quantité", "Entrepôt", "Coût unitaire"],
      ["CIM-50", "400", wh.name, "5100"], ["PRD-00001", "12,5", "", ""], ["SRV-1", "3", "", ""], ["INCONNU", "1", "", ""], ["CIM-50", "5", wh.name, ""], ["CIM-50", "-3", "", ""]]);
    expect(stock.p).toMatchObject({ valid: 2, errors: 4 });
    expect(stock.p.preview.map((r) => r.messages.join(" ")).join("|")).toContain("suivi de stock n'est pas activé");
    await runImport(s.ctx, stock.a.id);
    const qty = async (sku: string) => Number((await s.ctx.db.stockLevel.aggregate({ where: { product: { sku } }, _sum: { quantity: true } }))._sum.quantity ?? 0);
    expect(await qty("CIM-50")).toBe(400);
    expect(await qty("PRD-00001")).toBe(12.5);
    expect(await s.ctx.db.stockMovement.count({ where: { reason: "Import de stock" } })).toBe(2);
    // produits rejoués : existants ignorés (par référence, ou par nom quand elle est vide)
    const again = await run(s.ctx, "products", [["Désignation", "Référence"], ["Ciment 50 kg", "CIM-50"], ["Sable", ""]]);
    expect(again.p).toMatchObject({ valid: 0, ignored: 2 });
  });
});

describe("exports de données", () => {
  const rel = (s: S, kind: string, ctx = s.ctx) => EXPORTERS[kind]!.build(ctx, () => undefined);

  it("accès : module actif et droits « export » + lecture ; salaires exclus sans droit", async () => {
    const s = await setup();
    const allowed = (ctx: S["ctx"], kind: string) => { const x = EXPORTERS[kind]!; return (!x.module || ctx.hasModule(x.module)) && x.permissions.every((p) => ctx.can(p)); };
    const viewer = await ctxFor((await addMember(s.company.id, "viewer")).user.id, s.company.id); // lecture seule, sans export
    const cfo = await ctxFor((await addMember(s.company.id, "cfo")).user.id, s.company.id);
    expect(allowed(s.ctx, "clients")).toBe(true);
    expect(allowed(viewer, "clients")).toBe(false);
    expect(allowed(cfo, "salaries")).toBe(false); // pas de lecture RH
    for (const k of ["clients", "fournisseurs", "produits", "stock", "salaries"]) expect(EXPORTERS[k]!.permissions).toContain("data.export.run");
    await emp.createEmployee(s.ctx, { firstName: "Awa", lastName: "Koné", hireDate: "2024-01-06", baseSalary: 450000, payoutMethod: "BANK_TRANSFER" } as never);
    expect((await rel(s, "salaries")).columns.map((c) => c.key)).toContain("salary");
    const limited = await memberWith(s, ["data.export.run", "hr.employee.read"]);
    const t = await rel(s, "salaries", limited.ctx);
    expect(t.columns.map((c) => c.key)).not.toContain("salary");
    expect(JSON.stringify(t.rows)).not.toContain("450000");
    await setCompanyModule(s.company.id, "hr", false);
    expect(allowed(await ctxFor(s.owner.id, s.company.id), "salaries")).toBe(false);
  });

  it("isolation et aller-retour : l'export d'une entreprise ne contient que ses clients, et se réimporte sans doublon", async () => {
    const a = await setup(), b = await setup();
    const ra = await run(a.ctx, "customers", [["Nom", "E-mail", "Ville", "Pays", "Délai de paiement"], ["Client A1", "a1@exemple.ci", "Abidjan", "Côte d'Ivoire", "45"], ["=Pirate()", "", "Dakar", "Sénégal", "30"]]);
    await runImport(a.ctx, ra.a.id);
    await run(b.ctx, "customers", [["Nom"], ["Client B1"]]).then((x) => runImport(b.ctx, x.a.id));
    const table = await rel(a, "clients");
    expect(table.rows.map((r) => r.name).sort()).toEqual(["=Pirate()", "Client A1"]);
    expect(JSON.stringify(table.rows)).not.toContain("Client B1");
    // CSV : formule neutralisée à l'export
    const out = (await renderExport(table, "csv")).toString("utf8");
    expect(out).toContain("'=Pirate()");
    // le fichier exporté se réimporte tel quel : tout est reconnu et ignoré (déjà présent)
    const back = await analyzeImport(a.ctx, "customers", { name: "export.csv", size: 1 }, Buffer.from(out.replace(/'=Pirate\(\)/, "Pirate")));
    expect(back.suggested).toMatchObject({ name: 1, email: 3, phone: 4, city: 5 });
    const p = await previewImport(a.ctx, back.id, back.suggested);
    expect(p).toMatchObject({ errors: 0, ignored: 1, valid: 1 }); // « Client A1 » existe ; « Pirate » est nouveau
  });

  it("modèles d'import et rapport d'anomalies exportables, avec les valeurs d'origine", async () => {
    const s = await setup();
    const t = await EXPORTERS["modele-customers"]!.build(s.ctx, () => undefined);
    expect(t.columns[0]!.label).toContain("*"); // champ obligatoire signalé
    expect(suggestMapping(t.columns.map((c) => c.label), fieldsFor(s.ctx, ENTITIES.customers))).toMatchObject({ name: 0 }); // le modèle est reconnu tel quel
    const modele = await analyzeImport(s.ctx, "customers", { name: "modele.csv", size: 1 }, await renderExport(t, "csv"));
    expect((await previewImport(s.ctx, modele.id, modele.suggested)).valid).toBe(1); // la ligne d'exemple est valide
    const { a } = await run(s.ctx, "customers", [["Nom", "E-mail"], ["", "x@exemple.ci"], ["Valide SARL", ""]]);
    await runImport(s.ctx, a.id);
    const report = await EXPORTERS["import-rapport"]!.build(s.ctx, (k) => ({ job: a.id })[k]);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ line: 2, result: "Erreur", c1: "x@exemple.ci" });
    await expect(EXPORTERS["import-rapport"]!.build(s.ctx, () => "pas-un-id")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const other = await setup();
    await expect(EXPORTERS["import-rapport"]!.build(other.ctx, (k) => ({ job: a.id })[k])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
