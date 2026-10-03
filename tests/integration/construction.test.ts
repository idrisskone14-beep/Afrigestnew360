import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs"), os = process.getBuiltinModule("node:os"), path = process.getBuiltinModule("node:path");
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "afg-cons-"));
});

import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import * as bills from "@/modules/purchasing/bills";
import { supplierBillSchema, supplierSchema } from "@/modules/purchasing/schemas";
import * as sup from "@/modules/purchasing/suppliers";
import { budgetSchema, equipmentSchema, materialSchema, memberSchema, planSchema, reportSchema, siteSchema, subcontractSchema } from "@/modules/construction/schemas";
import * as cs from "@/modules/construction/service";
import { customerSchema } from "@/modules/crm/schemas";
import * as crm from "@/modules/crm/service";
import { documentMetaSchema } from "@/modules/documents/schemas";
import * as docs from "@/modules/documents/service";
import * as ex from "@/modules/finance/expenses";
import { expenseSchema, manualTransactionSchema } from "@/modules/finance/schemas";
import * as tr from "@/modules/finance/treasury";
import { createVehicle } from "@/modules/fleet/service";
import { vehicleSchema } from "@/modules/fleet/schemas";
import * as emp from "@/modules/hr/employees";
import { employeeSchema } from "@/modules/hr/schemas";
import { productSchema } from "@/modules/inventory/schemas";
import * as inv from "@/modules/inventory/service";
import { setCompanyModule } from "@/modules/platform/companies";
import { taskSchema, timeSchema } from "@/modules/projects/schemas";
import * as pj from "@/modules/projects/service";
import * as invoices from "@/modules/sales/invoices";
import { invoiceSchema } from "@/modules/sales/schemas";
import { addMember, ctxFor, makeCompany } from "../helpers";

const iso = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const PDF = Buffer.from("%PDF-1.4\n%%EOF");

async function setup() {
  const co = await makeCompany("CHANTIER", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const customer = await crm.createCustomer(ctx, customerSchema.parse({ type: "COMPANY", name: "Promoteur Riviera", paymentTermsDays: 30 }));
  const wh = (await inv.listWarehouses(ctx))[0]!;
  const product = (name = "Ciment 50 kg", qty = 1000, cost = 5000) => inv.createProduct(ctx, productSchema.parse({ name, type: "GOODS", unit: "sac", salePrice: 6500, costPrice: cost, trackStock: true, minStock: 0, openingWarehouseId: wh.id, openingQuantity: qty }));
  const site = (over: Record<string, unknown> = {}) => cs.createSite(ctx, siteSchema.parse({ name: "Résidence Les Palmiers", customerId: customer.id, city: "Abidjan", startDate: iso(-30), ...over }));
  const stock = async (productId: string) => Number((await ctx.db.stockLevel.aggregate({ where: { productId }, _sum: { quantity: true } }))._sum.quantity ?? 0);
  return { ...co, ctx, customer, wh, product, site, stock };
}

describe("chantier et projet associé", () => {
  it("création : code CHA-, projet créé automatiquement, références contrôlées ; le projet suit le chantier", async () => {
    const s = await setup();
    const a = await s.site();
    expect(a.code).toBe("CHA-0001");
    const p = await s.ctx.db.project.findFirstOrThrow({ where: { id: a.projectId } });
    expect(p).toMatchObject({ name: "Résidence Les Palmiers", customerId: s.customer.id, status: "PLANNED" });
    expect((await s.site({ name: "Deuxième" })).code).toBe("CHA-0002");
    await expect(s.site({ customerId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(s.site({ managerId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(s.site({ startDate: iso(10), endDate: iso(5) })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    // mise à jour : nom, statut et dates répercutés sur le projet
    await cs.updateSite(s.ctx, { ...siteSchema.parse({ name: "Les Palmiers — tranche 1", customerId: s.customer.id }), id: a.id, status: "ACTIVE" } as never);
    expect(await s.ctx.db.project.findFirstOrThrow({ where: { id: a.projectId } })).toMatchObject({ name: "Les Palmiers — tranche 1", status: "ACTIVE" });
    // « terminé » refusé tant que des tâches du projet sont ouvertes
    await pj.createTask(s.ctx, taskSchema.parse({ projectId: a.projectId, title: "Fondations" }));
    await expect(cs.updateSite(s.ctx, { ...siteSchema.parse({ name: "Les Palmiers — tranche 1" }), id: a.id, status: "DONE" } as never)).rejects.toMatchObject({ message: expect.stringContaining("tâche") });
    // un chantier en cours ne se retire pas
    await expect(cs.archiveSite(s.ctx, a.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("module Projets requis ; isolation entre entreprises", async () => {
    const A = await setup(), B = await setup();
    const a = await A.site();
    await expect(cs.getSite(B.ctx, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(cs.setBudget(B.ctx, budgetSchema.parse({ siteId: a.id, lines: [] }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(cs.saveReport(B.ctx, reportSchema.parse({ siteId: a.id, date: iso(0), summary: "Piratage", progress: 10 }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(cs.siteSummary(B.ctx, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await cs.listSites(B.ctx, { skip: 0, take: 10 })).total).toBe(0);
    await expect(cs.createSite(B.ctx, siteSchema.parse({ name: "Chantier B", customerId: A.customer.id }))).rejects.toMatchObject({ code: "NOT_FOUND" }); // client d'une autre entreprise
    await setCompanyModule(B.company.id, "projects", false);
    await expect(cs.createSite(await ctxFor(B.owner.id, B.company.id), siteSchema.parse({ name: "Sans projets" }))).rejects.toMatchObject({ message: expect.stringContaining("Projets") });
  });
});

describe("budget, équipe, engins", () => {
  it("budget par catégorie → budget du projet ; catégorie en double et chantier clos refusés", async () => {
    const s = await setup();
    const a = await s.site();
    await cs.setBudget(s.ctx, budgetSchema.parse({ siteId: a.id, lines: [{ category: "MATERIALS", amount: 3_000_000 }, { category: "LABOUR", amount: 1_500_000 }, { category: "OTHER", amount: 0 }] }));
    expect(Number((await s.ctx.db.project.findFirstOrThrow({ where: { id: a.projectId } })).budget)).toBe(4_500_000);
    expect(await s.ctx.db.siteBudgetLine.count({ where: { siteId: a.id } })).toBe(2); // une ligne à 0 n'est pas conservée
    await expect(cs.setBudget(s.ctx, budgetSchema.parse({ siteId: a.id, lines: [{ category: "MATERIALS", amount: 1 }, { category: "MATERIALS", amount: 2 }] }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(budgetSchema.safeParse({ siteId: a.id, lines: [{ category: "MATERIALS", amount: -5 }] }).success).toBe(false);
    await cs.updateSite(s.ctx, { ...siteSchema.parse({ name: "Résidence Les Palmiers" }), id: a.id, status: "CANCELLED" } as never);
    await expect(cs.setBudget(s.ctx, budgetSchema.parse({ siteId: a.id, lines: [] }))).rejects.toMatchObject({ message: expect.stringContaining("annulé") });
  });

  it("équipe : pas de doublon sur la période ; engins de la flotte : un seul chantier à la fois", async () => {
    const s = await setup();
    const a = await s.site(), b = await s.site({ name: "Autre chantier" });
    const e = await emp.createEmployee(s.ctx, employeeSchema.parse({ firstName: "Awa", lastName: "Koné", hireDate: "2020-01-06", baseSalary: 300000 }));
    await cs.addMember(s.ctx, memberSchema.parse({ siteId: a.id, employeeId: e.id, role: "Chef d'équipe", startDate: iso(-10) }));
    await expect(cs.addMember(s.ctx, memberSchema.parse({ siteId: a.id, employeeId: e.id, startDate: iso(-5) }))).rejects.toMatchObject({ code: "CONFLICT" });
    const m = (await cs.siteSummary(s.ctx, a.id)).team[0]!;
    expect(m).toMatchObject({ name: "Koné Awa", role: "Chef d'équipe" });
    await cs.endMember(s.ctx, m.id);
    await cs.addMember(s.ctx, memberSchema.parse({ siteId: a.id, employeeId: e.id, startDate: iso(1) })); // après la fin : autorisé
    await expect(cs.addMember(s.ctx, memberSchema.parse({ siteId: a.id, employeeId: "00000000-0000-4000-8000-000000000000", startDate: iso(0) }))).rejects.toMatchObject({ code: "NOT_FOUND" });

    const grue = await createVehicle(s.ctx, vehicleSchema.parse({ plate: "ENGIN-001", type: "MACHINE", fuelType: "DIESEL" }));
    await cs.addEquipment(s.ctx, equipmentSchema.parse({ siteId: a.id, vehicleId: grue.id, name: "Pelleteuse", dailyRate: 150000, startDate: iso(-4) }));
    await expect(cs.addEquipment(s.ctx, equipmentSchema.parse({ siteId: b.id, vehicleId: grue.id, name: "Pelleteuse", dailyRate: 1, startDate: iso(-1) }))).rejects.toMatchObject({ message: expect.stringContaining("déjà affecté") });
    const sum = await cs.siteSummary(s.ctx, a.id);
    expect(sum.equipment[0]).toMatchObject({ days: 5, cost: 750000 }); // du jour -4 au jour 0 inclus
    expect(sum.actual.EQUIPMENT).toBe(750000);
    await cs.endEquipment(s.ctx, sum.equipment[0]!.id);
    await expect(cs.addEquipment(s.ctx, equipmentSchema.parse({ siteId: b.id, vehicleId: grue.id, name: "Pelleteuse", dailyRate: 1, startDate: iso(1) }))).resolves.toBeTruthy();
    await setCompanyModule(s.company.id, "fleet", false);
    await expect(cs.addEquipment(await ctxFor(s.owner.id, s.company.id), equipmentSchema.parse({ siteId: a.id, vehicleId: grue.id, name: "x1", startDate: iso(0) }))).rejects.toMatchObject({ message: expect.stringContaining("Flotte") });
  });
});

describe("matériaux et stock", () => {
  it("sortie = vrai mouvement de stock (disponible contrôlé, coût figé) ; retour limité à la quantité sortie", async () => {
    const s = await setup();
    const a = await s.site();
    const p = await s.product("Ciment", 100, 5000);
    const move = (type: "ISSUE" | "RETURN", quantity: number, over: Record<string, unknown> = {}) => cs.moveMaterial(s.ctx, materialSchema.parse({ siteId: a.id, productId: p.id, warehouseId: s.wh.id, type, quantity, date: iso(0), ...over }));
    await move("ISSUE", 40);
    expect(await s.stock(p.id)).toBe(60);
    const mv = await s.ctx.db.stockMovement.findFirstOrThrow({ where: { productId: p.id, sourceType: "construction_site" } });
    expect(mv).toMatchObject({ type: "OUT", sourceId: a.id, reference: a.code });
    expect(Number(mv.quantity)).toBe(-40);
    await expect(move("ISSUE", 61)).rejects.toMatchObject({ message: expect.stringContaining("Stock insuffisant") });
    expect(await s.stock(p.id)).toBe(60); // rien n'est sorti en cas de refus
    await expect(move("RETURN", 41)).rejects.toMatchObject({ message: expect.stringContaining("Retour supérieur") });
    await move("RETURN", 10);
    expect(await s.stock(p.id)).toBe(70);
    // la valorisation du coût moyen n'est pas faussée par les mouvements du chantier
    expect(Number((await inv.getProduct(s.ctx, p.id)).product.costPrice)).toBe(5000);
    // le coût est figé au moment de la sortie : un changement de prix ensuite ne le modifie pas
    await s.ctx.db.product.update({ where: { id: p.id }, data: { costPrice: "9000" } });
    await move("ISSUE", 10);
    const sum = await cs.siteSummary(s.ctx, a.id);
    expect(sum.actual.MATERIALS).toBe(30 * 5000 - 0 + 10 * 9000 - 30 * 5000 + 30 * 5000 - 0 === 0 ? 0 : (40 - 10) * 5000 + 10 * 9000);
    expect(sum.materials[0]).toMatchObject({ issued: 40, cost: 240000 });
    await expect(move("ISSUE", 1, { date: iso(10) })).rejects.toMatchObject({ message: expect.stringContaining("futur") });
    // service ou produit non suivi en stock
    const service = await inv.createProduct(s.ctx, productSchema.parse({ name: "Conseil", type: "SERVICE", unit: "h", salePrice: 1, costPrice: 0, trackStock: false, minStock: 0 }));
    await expect(cs.moveMaterial(s.ctx, materialSchema.parse({ siteId: a.id, productId: service.id, warehouseId: s.wh.id, type: "ISSUE", quantity: 1, date: iso(0) }))).rejects.toMatchObject({ message: expect.stringContaining("pas géré en stock") });
  });

  it("deux retours simultanés ne dépassent jamais ensemble la quantité sortie ; isolation du stock", async () => {
    const A = await setup(), B = await setup();
    const a = await A.site();
    const p = await A.product("Fer", 100, 7000);
    await cs.moveMaterial(A.ctx, materialSchema.parse({ siteId: a.id, productId: p.id, warehouseId: A.wh.id, type: "ISSUE", quantity: 30, date: iso(0) }));
    const back = () => cs.moveMaterial(A.ctx, materialSchema.parse({ siteId: a.id, productId: p.id, warehouseId: A.wh.id, type: "RETURN", quantity: 20, date: iso(0) }));
    const r = await Promise.allSettled([back(), back()]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await A.stock(p.id)).toBe(90);
    // B ne peut ni sortir le produit de A, ni utiliser son entrepôt
    const bsite = await B.site();
    await expect(cs.moveMaterial(B.ctx, materialSchema.parse({ siteId: bsite.id, productId: p.id, warehouseId: B.wh.id, type: "ISSUE", quantity: 1, date: iso(0) }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(cs.moveMaterial(B.ctx, materialSchema.parse({ siteId: a.id, productId: p.id, warehouseId: A.wh.id, type: "ISSUE", quantity: 1, date: iso(0) }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await A.stock(p.id)).toBe(90);
  });

  it("matériaux prévus : suivi prévu / sorti", async () => {
    const s = await setup();
    const a = await s.site();
    const p = await s.product("Sable", 500, 1500);
    await cs.setMaterialPlan(s.ctx, planSchema.parse({ siteId: a.id, productId: p.id, plannedQty: 200 }));
    await cs.setMaterialPlan(s.ctx, planSchema.parse({ siteId: a.id, productId: p.id, plannedQty: 250 })); // mise à jour, pas de doublon
    await cs.moveMaterial(s.ctx, materialSchema.parse({ siteId: a.id, productId: p.id, warehouseId: s.wh.id, type: "ISSUE", quantity: 80, date: iso(0) }));
    expect((await cs.siteSummary(s.ctx, a.id)).materials).toEqual([{ productId: p.id, name: "Sable", unit: "sac", planned: 250, issued: 80, cost: 120000 }]);
    expect(await s.ctx.db.siteMaterialPlan.count()).toBe(1);
  });
});

describe("budget réel, avancement et rentabilité", () => {
  it("réel par catégorie : matériaux, main-d'œuvre, sous-traitance, autres ; prévision selon l'avancement ; marge", async () => {
    const s = await setup();
    const a = await s.site();
    await cs.setBudget(s.ctx, budgetSchema.parse({ siteId: a.id, lines: [{ category: "MATERIALS", amount: 1_000_000 }, { category: "LABOUR", amount: 500_000 }, { category: "SUBCONTRACT", amount: 600_000 }, { category: "OTHER", amount: 200_000 }] }));
    // matériaux : 100 000
    const p = await s.product("Ciment", 100, 5000);
    await cs.moveMaterial(s.ctx, materialSchema.parse({ siteId: a.id, productId: p.id, warehouseId: s.wh.id, type: "ISSUE", quantity: 20, date: iso(0) }));
    // main-d'œuvre : 8 h × (352 000 / 176 = 2 000) = 16 000
    const e = await emp.createEmployee(s.ctx, employeeSchema.parse({ firstName: "Moussa", lastName: "Diallo", hireDate: "2020-01-06", baseSalary: 352000 }));
    await pj.logTime(s.ctx, timeSchema.parse({ projectId: a.projectId, employeeId: e.id, date: iso(-1), hours: 8, billable: false }));
    // sous-traitance : facture du sous-traitant rattachée au projet (150 000), autre facture directe (40 000)
    const subco = await sup.createSupplier(s.ctx, supplierSchema.parse({ name: "Électricité Générale", paymentTermsDays: 30 }));
    const other = await sup.createSupplier(s.ctx, supplierSchema.parse({ name: "Location outils", paymentTermsDays: 30 }));
    await cs.addSubcontract(s.ctx, subcontractSchema.parse({ siteId: a.id, supplierId: subco.id, scope: "Électricité du bâtiment", contractAmount: 600000 }));
    const bill = async (supplierId: string, price: number) => bills.postBill(s.ctx, (await bills.createBill(s.ctx, supplierBillSchema.parse({ supplierId, supplierRef: `F-${Math.random()}`, billDate: iso(-2), projectId: a.projectId, lines: [{ description: "Prestation", quantity: 1, unitPrice: price, taxId: "" }] } as never))).id);
    await bill(subco.id, 150000);
    await bill(other.id, 40000);
    // dépense payée imputée au projet : 25 000
    const bank = (await tr.listAccounts(s.ctx)).find((x) => x.type === "BANK")!;
    await tr.createManualTransaction(s.ctx, manualTransactionSchema.parse({ accountId: bank.id, type: "IN", date: iso(-20), amount: 1_000_000, description: "Apport", categoryId: (await tr.listCategories(s.ctx, { kind: "INCOME" }))[0]!.id }));
    const cat = (await tr.listCategories(s.ctx, { kind: "EXPENSE" }))[0]!;
    const exp = await ex.createExpense(s.ctx, expenseSchema.parse({ date: iso(-1), categoryId: cat.id, description: "Gardiennage", amount: 25000, method: "BANK_TRANSFER", projectId: a.projectId }));
    await ex.submitExpense(s.ctx, exp.id);
    await ex.payExpense(s.ctx, { id: exp.id, accountId: bank.id, date: iso(-1), method: "BANK_TRANSFER" } as never);
    // produit facturé au client : 500 000 HT
    const customerInv = await invoices.createInvoice(s.ctx, invoiceSchema.parse({ customerId: s.customer.id, issueDate: iso(-1), projectId: a.projectId, lines: [{ description: "Situation n°1", unit: "forfait", quantity: 1, unitPrice: 500000, discountPct: 0 }] } as never));
    await invoices.issueInvoice(s.ctx, { id: customerInv.id, installments: 1, allowOverLimit: false });
    // avancement : 25 % d'après le rapport terrain
    await cs.saveReport(s.ctx, reportSchema.parse({ siteId: a.id, date: iso(0), summary: "Fondations coulées", progress: 25, workforce: 12 }));

    const sum = await cs.siteSummary(s.ctx, a.id);
    expect(sum.actual).toEqual({ MATERIALS: 100000, LABOUR: 16000, EQUIPMENT: 0, SUBCONTRACT: 150000, OTHER: 65000 }); // 25 000 + 40 000
    expect(sum.actualTotal).toBe(331000);
    expect(sum.budgetTotal).toBe(2_300_000);
    expect(sum.usedPct).toBe(14.4);
    expect(sum.progress).toBe(25);
    expect(sum.forecast).toBe(1_324_000); // 331 000 ÷ 25 %
    expect(sum.overrun).toBe(false);
    expect(sum.revenue).toBe(500000);
    expect(sum.margin).toBe(169000);
    expect(sum.subcontracts[0]).toMatchObject({ supplier: "Électricité Générale", contractAmount: 600000, billed: 150000 });
    // sans droit de lecture finance / achats / ventes : ces montants sont absents (jamais estimés)
    const limited = await ctxFor((await addMember(s.company.id, "project_manager")).user.id, s.company.id); // pas de finance.expense.read ni purchases.bill.read
    const lim = await cs.siteSummary(limited, a.id);
    expect(lim.actual.SUBCONTRACT).toBeNull();
    expect(lim.actual.OTHER).toBeNull();
    expect(lim.revenue).toBeNull();
    expect(lim.margin).toBeNull();
    expect(lim.actual.MATERIALS).toBe(100000);
  });

  it("dépassement détecté : réel au-delà du budget, ou prévision à l'avancement supérieure au budget", async () => {
    const s = await setup();
    const a = await s.site();
    await cs.setBudget(s.ctx, budgetSchema.parse({ siteId: a.id, lines: [{ category: "MATERIALS", amount: 300000 }] }));
    const p = await s.product("Brique", 1000, 1000);
    await cs.moveMaterial(s.ctx, materialSchema.parse({ siteId: a.id, productId: p.id, warehouseId: s.wh.id, type: "ISSUE", quantity: 100, date: iso(0) })); // 100 000
    await cs.saveReport(s.ctx, reportSchema.parse({ siteId: a.id, date: iso(0), summary: "Élévation des murs", progress: 20 }));
    const sum = await cs.siteSummary(s.ctx, a.id);
    expect(sum).toMatchObject({ actualTotal: 100000, forecast: 500000, overrun: true }); // 20 % d'avancement pour 33 % du budget consommé
    await cs.saveReport(s.ctx, reportSchema.parse({ siteId: a.id, date: iso(0), summary: "Élévation des murs", progress: 50 }));
    expect((await cs.siteSummary(s.ctx, a.id)).overrun).toBe(false); // prévision 200 000 < 300 000
  });
});

describe("rapports terrain et documents", () => {
  it("un rapport par jour (mise à jour), avancement = dernier rapport, dates et chantier clos contrôlés", async () => {
    const s = await setup();
    const a = await s.site({ startDate: iso(-10) });
    const r1 = await cs.saveReport(s.ctx, reportSchema.parse({ siteId: a.id, date: iso(-2), summary: "Terrassement", progress: 10, workforce: 8, weather: "Soleil" }));
    await cs.saveReport(s.ctx, reportSchema.parse({ siteId: a.id, date: iso(-1), summary: "Fondations", progress: 30, incidents: "Panne de bétonnière" }));
    expect((await cs.getSite(s.ctx, a.id)).progress).toBe(30);
    const again = await cs.saveReport(s.ctx, reportSchema.parse({ siteId: a.id, date: iso(-2), summary: "Terrassement (corrigé)", progress: 12 })); // jour passé corrigé
    expect(again.id).toBe(r1.id);
    expect((await cs.getSite(s.ctx, a.id)).progress).toBe(30); // le plus récent fait foi
    expect(await s.ctx.db.siteReport.count({ where: { siteId: a.id } })).toBe(2);
    await expect(cs.saveReport(s.ctx, reportSchema.parse({ siteId: a.id, date: iso(3), summary: "Futur", progress: 40 }))).rejects.toMatchObject({ message: expect.stringContaining("futur") });
    await expect(cs.saveReport(s.ctx, reportSchema.parse({ siteId: a.id, date: iso(-20), summary: "Avant le début", progress: 1 }))).rejects.toMatchObject({ message: expect.stringContaining("début") });
    expect(reportSchema.safeParse({ siteId: a.id, date: iso(0), summary: "x", progress: 120 }).success).toBe(false);
    await cs.updateSite(s.ctx, { ...siteSchema.parse({ name: "Résidence Les Palmiers" }), id: a.id, status: "CANCELLED" } as never);
    await expect(cs.saveReport(s.ctx, reportSchema.parse({ siteId: a.id, date: iso(0), summary: "Clos", progress: 50 }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("photos et pièces via la GED : liées au chantier ou au rapport, avec le droit de lecture des chantiers", async () => {
    const s = await setup();
    const a = await s.site();
    const report = await cs.saveReport(s.ctx, reportSchema.parse({ siteId: a.id, date: iso(0), summary: "Coulage dalle", progress: 15 }));
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    await docs.createDocument(s.ctx, documentMetaSchema.parse({ name: "Photo dalle" }), { name: "dalle.png", size: png.length }, png, { entityType: "site_report", entityId: report.id });
    await docs.createDocument(s.ctx, documentMetaSchema.parse({ name: "Permis de construire" }), { name: "pc.pdf", size: PDF.length }, PDF, { entityType: "site", entityId: a.id });
    expect((await docs.listEntityDocuments(s.ctx, "site", a.id)).map((d) => d.name)).toEqual(["Permis de construire"]);
    expect((await docs.listEntityDocuments(s.ctx, "site_report", report.id)).map((d) => d.name)).toEqual(["Photo dalle"]);
    // un rôle sans droit « chantiers » ne voit pas ces documents ; une autre entreprise ne peut pas s'y lier
    const stock = await ctxFor((await addMember(s.company.id, "stock_manager")).user.id, s.company.id);
    expect(await docs.listEntityDocuments(stock, "site", a.id)).toEqual([]);
    const B = await setup();
    await expect(docs.createDocument(B.ctx, documentMetaSchema.parse({ name: "Intrus" }), { name: "x.pdf", size: PDF.length }, PDF, { entityType: "site", entityId: a.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
