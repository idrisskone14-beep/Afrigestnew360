import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { renderExport } from "@/core/export/table";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { customerSchema } from "@/modules/crm/schemas";
import * as crm from "@/modules/crm/service";
import * as ex from "@/modules/finance/expenses";
import { expenseSchema, manualTransactionSchema } from "@/modules/finance/schemas";
import * as tr from "@/modules/finance/treasury";
import * as emp from "@/modules/hr/employees";
import { employeeSchema } from "@/modules/hr/schemas";
import { setCompanyModule } from "@/modules/platform/companies";
import { projectSchema } from "@/modules/projects/schemas";
import * as pj from "@/modules/projects/service";
import * as bills from "@/modules/purchasing/bills";
import { supplierBillSchema, supplierSchema } from "@/modules/purchasing/schemas";
import * as sup from "@/modules/purchasing/suppliers";
import { REPORTS, REPORT_BY_KEY } from "@/modules/reports/catalog";
import { parseReportFilters, periodLabel } from "@/modules/reports/filters";
import { availableReports, buildReport, canRunReport } from "@/modules/reports/service";
import * as invoices from "@/modules/sales/invoices";
import * as payments from "@/modules/sales/payments";
import { invoiceSchema } from "@/modules/sales/schemas";
import { addMember, ctxFor, makeCompany } from "../helpers";

const iso = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const co = await makeCompany("RPT", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const tax = await ctx.db.tax.findFirstOrThrow({ where: { isDefault: true } });
  const customer = async (name: string) => crm.createCustomer(ctx, customerSchema.parse({ type: "COMPANY", name, paymentTermsDays: 30 }));
  /** Facture émise de qty × 10 000 HT (+18 % de TVA), à la date et l'échéance voulues. */
  const invoice = async (customerId: string, over: { qty?: number; date?: string; due?: string; branchId?: string; costCenterId?: string; projectId?: string } = {}) => {
    const draft = await invoices.createInvoice(ctx, invoiceSchema.parse({ customerId, issueDate: over.date ?? iso(0), dueDate: over.due ?? "", branchId: over.branchId ?? "", costCenterId: over.costCenterId ?? "", projectId: over.projectId ?? "", lines: [{ description: "Prestation", unit: "forfait", quantity: over.qty ?? 1, unitPrice: 10000, discountPct: 0, taxId: tax.id }] } as never));
    return invoices.issueInvoice(ctx, { id: draft.id, installments: 1, allowOverLimit: false });
  };
  const member = async (key: string) => { const m = await addMember(co.company.id, key); return { ...m, ctx: await ctxFor(m.user.id, co.company.id) }; };
  return { ...co, ctx, tax, customer, invoice, member };
}
type S = Awaited<ReturnType<typeof setup>>;
const run = (ctx: S["ctx"], key: string, q: Record<string, string> = {}) => buildReport(ctx, key, (k) => q[k]);
const rowsOf = async (ctx: S["ctx"], key: string, q: Record<string, string> = {}) => (await run(ctx, key, q)).result.table.rows;

describe("filtres de rapport (purs)", () => {
  const def = (over = {}) => ({ filters: ["period", "customer"] as never, defaultPeriod: "month" as const, option: undefined, ...over });
  it("période par défaut, bornes inclusives, dates inversées, valeurs invalides ignorées", () => {
    const now = new Date("2026-10-15T10:00:00Z");
    const d = parseReportFilters(def(), () => undefined, now);
    expect(d.from?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(d.to?.toISOString()).toBe("2026-10-16T00:00:00.000Z"); // jusqu'à aujourd'hui inclus
    const sp = { du: "2026-03-10", au: "2026-03-01", client: "pas-un-uuid", projet: "00000000-0000-4000-8000-000000000001" };
    const f = parseReportFilters(def(), (k) => (sp as Record<string, string>)[k], now);
    expect(f.from?.toISOString()).toBe("2026-03-01T00:00:00.000Z"); // remises dans l'ordre
    expect(f.to?.toISOString()).toBe("2026-03-11T00:00:00.000Z");
    expect(f.customerId).toBeUndefined(); // identifiant invalide
    expect(f.projectId).toBeUndefined(); // filtre non pris en charge par ce rapport : ignoré
    expect(parseReportFilters(def({ defaultPeriod: "none" }), () => undefined, now).from).toBeUndefined();
    expect(parseReportFilters(def({ defaultPeriod: "year" }), () => undefined, now).from?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(periodLabel(f)).toContain("mars 2026");
  });

  it("chaque rapport ne déclare que des filtres réellement exploités et un module existant", () => {
    expect(REPORTS.length).toBe(14);
    expect(new Set(REPORTS.map((r) => r.key)).size).toBe(14);
    for (const r of REPORTS) expect(r.filters.length >= 0 && r.title.length > 0 && r.run).toBeTruthy();
    expect(REPORT_BY_KEY.get("stocks")!.filters).toEqual([]); // pas de filtre décoratif
  });
});

describe("accès aux rapports", () => {
  it("module actif + droit « rapports » + droit de lecture des données sources", async () => {
    const s = await setup();
    const accountant = await s.member("accountant"); // reports.report.read, finances, pas de RH ni de projets
    const employee = await s.member("employee"); // aucun droit de rapport
    const viewer = await s.member("viewer"); // *.read : rapports accessibles mais pas l'export
    const keys = (c: S["ctx"]) => availableReports(c).map((r) => r.key);
    expect(keys(s.ctx)).toHaveLength(14);
    expect(keys(accountant.ctx)).toEqual(expect.arrayContaining(["ventes", "depenses", "resultat", "tresorerie", "creances-clients", "dettes-fournisseurs"]));
    expect(keys(accountant.ctx)).not.toContain("rh");
    expect(keys(accountant.ctx)).not.toContain("projets");
    expect(keys(employee.ctx)).toEqual([]);
    await expect(run(employee.ctx, "ventes")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(accountant.ctx, "rh")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(s.ctx, "inexistant")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(keys(viewer.ctx)).toHaveLength(14);
    expect(viewer.ctx.can("reports.export.run")).toBe(false);
    expect(s.ctx.can("reports.export.run")).toBe(true);
    // un module désactivé retire ses rapports
    await setCompanyModule(s.company.id, "sales", false);
    const after = await ctxFor(s.owner.id, s.company.id);
    expect(canRunReport(after, REPORT_BY_KEY.get("ventes")!)).toBe(false);
    await expect(run(after, "chiffre-affaires")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await setCompanyModule(s.company.id, "reports", false);
    expect(availableReports(await ctxFor(s.owner.id, s.company.id))).toEqual([]);
  });
});

describe("ventes, chiffre d'affaires et filtres", () => {
  it("période (fin incluse), client, regroupement par client ; totaux cohérents entre rapports", async () => {
    const s = await setup();
    const a = await s.customer("Alpha SARL"), b = await s.customer("Bêta SA");
    await s.invoice(a.id, { qty: 2, date: iso(-40) }); // hors période
    await s.invoice(a.id, { qty: 3, date: iso(-5) });
    await s.invoice(b.id, { qty: 1, date: iso(-2) });
    await s.invoice(b.id, { qty: 4, date: iso(0) }); // dernier jour de la période : inclus
    const q = { du: iso(-10), au: iso(0) };
    const detail = await run(s.ctx, "ventes", { ...q, vue: "facture" });
    expect(detail.result.table.rows).toHaveLength(3);
    expect(detail.result.table.totals).toMatchObject({ ht: 80000, tva: 14400, ttc: 94400 });
    expect(detail.result.table.filters?.[0]?.[0]).toBe("Période");
    // filtre client
    expect(await rowsOf(s.ctx, "ventes", { ...q, client: a.id })).toHaveLength(1);
    // regroupé par client
    const grouped = await rowsOf(s.ctx, "ventes", { ...q, vue: "client" });
    expect(grouped.map((r) => [r.customer, r.ht])).toEqual([["Bêta SA", 50000], ["Alpha SARL", 30000]]);
    // le chiffre d'affaires mensuel recoupe le détail
    const ca = await run(s.ctx, "chiffre-affaires", { du: iso(-60), au: iso(0) });
    expect(ca.result.table.totals).toMatchObject({ count: 4, ht: 100000 });
    expect(ca.result.chart!.data.reduce((acc, d) => acc + d.value, 0)).toBe(100000);
    // identifiants forgés ou d'une autre entreprise : aucun résultat, jamais d'erreur ni de fuite
    const other = await setup();
    const foreign = await other.customer("Étranger");
    expect(await rowsOf(s.ctx, "ventes", { ...q, client: foreign.id })).toHaveLength(0);
    expect((await run(s.ctx, "ventes", { ...q, client: foreign.id })).result.table.filters).toContainEqual(["Client", "(introuvable)"]);
  });

  it("isolation : le rapport d'une entreprise ne contient jamais les factures d'une autre", async () => {
    const a = await setup(), b = await setup();
    await a.invoice((await a.customer("Client A")).id, { qty: 5 });
    await b.invoice((await b.customer("Client B")).id, { qty: 1 });
    const ra = await run(a.ctx, "ventes", { du: iso(-1), au: iso(1) });
    const rb = await run(b.ctx, "ventes", { du: iso(-1), au: iso(1) });
    expect(ra.result.table.totals).toMatchObject({ ht: 50000 });
    expect(rb.result.table.totals).toMatchObject({ ht: 10000 });
    expect(JSON.stringify(rb.result.table.rows)).not.toContain("Client A");
    for (const key of ["creances-clients", "chiffre-affaires", "depenses", "tresorerie"]) {
      const r = (await run(b.ctx, key, { du: iso(-30), au: iso(1) })).result;
      expect(JSON.stringify(r.table.rows)).not.toContain("Client A");
    }
  });

  it("filtres agence, centre de coûts et projet appliqués aux ventes", async () => {
    const s = await setup();
    const c = await s.customer("Client Org");
    const branch = (await s.ctx.db.branch.findFirstOrThrow({ where: { isHeadquarters: true } })).id;
    const cc = (await s.ctx.db.costCenter.create({ data: { companyId: s.company.id, code: "CC-1", name: "Centre 1" } })).id;
    const project = await pj.createProject(s.ctx, projectSchema.parse({ name: "Chantier R", status: "ACTIVE" }));
    await s.invoice(c.id, { qty: 1, branchId: branch });
    await s.invoice(c.id, { qty: 2, costCenterId: cc });
    await s.invoice(c.id, { qty: 3, projectId: project.id });
    await s.invoice(c.id, { qty: 4 });
    const q = { du: iso(-1), au: iso(0) };
    expect((await rowsOf(s.ctx, "ventes", { ...q, agence: branch }))).toHaveLength(1);
    expect((await rowsOf(s.ctx, "ventes", { ...q, centre: cc }))).toHaveLength(1);
    expect((await rowsOf(s.ctx, "ventes", { ...q, projet: project.id }))).toHaveLength(1);
    expect((await rowsOf(s.ctx, "ventes", q))).toHaveLength(4);
    // utilisateur : factures créées par un autre membre
    const acc = await s.member("accountant");
    expect((await rowsOf(s.ctx, "ventes", { ...q, utilisateur: acc.user.id }))).toHaveLength(0);
    expect((await rowsOf(s.ctx, "ventes", { ...q, utilisateur: s.owner.id }))).toHaveLength(4);
  });
});

describe("créances et dettes (balance âgée)", () => {
  it("tranches d'ancienneté, paiements déduits, totaux", async () => {
    const s = await setup();
    const c = await s.customer("Débiteur");
    await s.invoice(c.id, { qty: 1, date: iso(-10), due: iso(10) }); // non échue : 11 800
    await s.invoice(c.id, { qty: 1, date: iso(-50), due: iso(-20) }); // 20 j de retard : 1 à 30 j
    const old = await s.invoice(c.id, { qty: 2, date: iso(-120), due: iso(-100) }); // 100 j : plus de 90 j
    await payments.recordPayment(s.ctx, { invoiceId: old.id, amount: 3600, method: "CASH", date: iso(0) } as never); // reste 20 000
    const { result } = await run(s.ctx, "creances-clients");
    const row = result.table.rows[0]!;
    expect(row).toMatchObject({ party: "Débiteur", current: 11800, d30: 11800, d60: 0, d90: 0, over: 20000 });
    expect(result.table.totals).toMatchObject({ total: 43600, current: 11800 });
    expect(result.summary.find((x) => x.label === "Dont échu")!.value).toContain("31");

    const supplier = await sup.createSupplier(s.ctx, supplierSchema.parse({ name: "Fournisseur Âgé", paymentTermsDays: 30 }));
    const post = async (due: string, price: number) => bills.postBill(s.ctx, (await bills.createBill(s.ctx, supplierBillSchema.parse({ supplierId: supplier.id, supplierRef: `F-${Math.random()}`, billDate: iso(-100), dueDate: due, lines: [{ description: "Achat", quantity: 1, unitPrice: price, taxId: "" }] } as never))).id);
    await post(iso(-70), 50000); // 61 à 90 j
    await post(iso(5), 30000); // non échue
    const dettes = (await run(s.ctx, "dettes-fournisseurs")).result;
    expect(dettes.table.rows[0]).toMatchObject({ party: "Fournisseur Âgé", current: 30000, d90: 50000, total: 80000 });
  });
});

describe("dépenses, trésorerie, stocks, résultat", () => {
  it("dépenses par catégorie (parts) et en détail ; filtres de période", async () => {
    const s = await setup();
    const cats = await tr.listCategories(s.ctx, { kind: "EXPENSE" });
    const bank = (await tr.listAccounts(s.ctx)).find((a) => a.type === "BANK")!;
    await tr.createManualTransaction(s.ctx, manualTransactionSchema.parse({ accountId: bank.id, type: "IN", date: iso(-60), amount: 5_000_000, description: "Apport", categoryId: (await tr.listCategories(s.ctx, { kind: "INCOME" }))[0]!.id }));
    const pay = async (cat: string, amount: number, date: string) => {
      const e = await ex.createExpense(s.ctx, expenseSchema.parse({ date, categoryId: cat, description: `Dépense ${amount}`, amount, method: "BANK_TRANSFER" }));
      await ex.submitExpense(s.ctx, e.id);
      await ex.payExpense(s.ctx, { id: e.id, accountId: bank.id, date, method: "BANK_TRANSFER" } as never);
    };
    await pay(cats[0]!.id, 100000, iso(-3));
    await pay(cats[0]!.id, 50000, iso(-2));
    await pay(cats[1]!.id, 50000, iso(-1));
    await pay(cats[1]!.id, 70000, iso(-30)); // hors période
    const q = { du: iso(-5), au: iso(0) };
    const byCat = (await run(s.ctx, "depenses", q)).result;
    expect(byCat.table.rows.map((r) => [r.amount, r.share])).toEqual([[150000, 75], [50000, 25]]);
    expect(byCat.table.totals).toMatchObject({ count: 3, amount: 200000, share: 100 });
    const detail = await run(s.ctx, "depenses", { ...q, vue: "detail" });
    expect(detail.result.table.rows).toHaveLength(3);
    expect(detail.result.table.totals).toMatchObject({ amount: 200000 });

    // trésorerie : ouverture, flux de la période, clôture = solde actuel
    const t = (await run(s.ctx, "tresorerie", { du: iso(-5), au: iso(0) })).result.table;
    const row = t.rows.find((r) => r.account === bank.name)!;
    expect(row).toMatchObject({ opening: 5_000_000 - 70000, inflow: 0, outflow: 200000, closing: 5_000_000 - 270000 });
    expect(Number((await tr.getAccount(s.ctx, bank.id)).balance)).toBe(row.closing);
    expect(t.totals).toMatchObject({ closing: 5_000_000 - 270000 });
  });

  it("résultat d'après les écritures comptables : les ventes émises apparaissent en produits", async () => {
    const s = await setup();
    await s.invoice((await s.customer("Client Résultat")).id, { qty: 5 });
    const { result } = await run(s.ctx, "resultat", { du: iso(-1), au: iso(0) });
    expect(result.table.totals?.amount).toBe(50000);
    expect(result.summary.map((x) => x.label)).toEqual(["Produits", "Charges", "Résultat"]);
    // période sans écritures : résultat nul
    expect((await run(s.ctx, "resultat", { du: iso(-400), au: iso(-300) })).result.table.totals?.amount).toBe(0);
  });
});

describe("RH, projets, commercial", () => {
  it("RH : la masse salariale n'apparaît que pour qui peut voir les salaires", async () => {
    const s = await setup();
    const hr = await s.member("hr");
    const pm = await s.member("project_manager"); // hr.employee.read seulement
    await emp.createEmployee(s.ctx, employeeSchema.parse({ firstName: "Awa", lastName: "Koné", hireDate: iso(-400), baseSalary: 300000 }));
    await emp.createEmployee(s.ctx, employeeSchema.parse({ firstName: "Moussa", lastName: "Diallo", hireDate: iso(-3), baseSalary: 200000 }));
    const full = (await run(hr.ctx, "rh", { du: iso(-10), au: iso(0) })).result.table;
    expect(full.columns.map((c) => c.key)).toContain("payroll");
    expect(full.totals).toMatchObject({ active: 2, hired: 1, payroll: 500000 });
    const limited = (await run(pm.ctx, "rh", { du: iso(-10), au: iso(0) })).result.table;
    expect(limited.columns.map((c) => c.key)).not.toContain("payroll");
    expect(limited.columns.map((c) => c.key)).not.toContain("leave"); // pas de droit sur les congés
    expect(JSON.stringify(limited)).not.toContain("500000");
  });

  it("projets : budget, coûts et marge ; commercial : réussite par commercial", async () => {
    const s = await setup();
    const c = await s.customer("Client Projet");
    const p = await pj.createProject(s.ctx, projectSchema.parse({ name: "Chantier Marge", status: "ACTIVE", budget: 100000, customerId: c.id }));
    await s.invoice(c.id, { qty: 3, projectId: p.id });
    const proj = (await run(s.ctx, "projets")).result.table;
    expect(proj.rows[0]).toMatchObject({ name: "Chantier Marge", budget: 100000, revenue: 30000, margin: 30000 });
    expect(proj.totals).toMatchObject({ revenue: 30000 });

    const stages = await crm.listStages(s.ctx);
    const won = stages.find((x) => x.kind === "WON")!, lost = stages.find((x) => x.kind === "LOST")!;
    const mk = async (amount: number) => crm.createOpportunity(s.ctx, { title: `Opp ${amount}`, customerId: c.id, stageId: stages[0]!.id, amount } as never);
    const o1 = await mk(2_000_000), o2 = await mk(500_000);
    await mk(900_000); // reste ouverte
    await crm.moveOpportunity(s.ctx, { id: o1.id, stageId: won.id });
    await crm.moveOpportunity(s.ctx, { id: o2.id, stageId: lost.id, lostReason: "Prix" });
    const com = (await run(s.ctx, "commercial", { du: iso(-1), au: iso(0) })).result.table;
    expect(com.totals).toMatchObject({ created: 3, won: 1, lost: 1, rate: 50, wonAmount: 2_000_000, openCount: 1, openAmount: 900_000 });
  });
});

describe("exports d'un rapport", () => {
  it("Excel, CSV et PDF reprennent exactement le tableau, avec les filtres en en-tête ; injection de formule neutralisée", async () => {
    const s = await setup();
    const evil = await s.customer("=SOMME(A1:A9)");
    await s.invoice(evil.id, { qty: 2 });
    const { result } = await run(s.ctx, "ventes", { du: iso(-1), au: iso(0), vue: "client" });
    const csv = (await renderExport(result.table, "csv")).toString("utf8");
    expect(csv).toContain("'=SOMME(A1:A9)"); // jamais interprété comme formule par Excel
    expect(csv).toContain("20000");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderExport(result.table, "xlsx")) as never);
    const ws = wb.worksheets[0]!;
    const text = JSON.stringify(ws.getSheetValues());
    expect(text).toContain("Période");
    expect(text).toContain("Ventes par client");
    expect(typeof ws.getRow(5).getCell(1).value).toBe("string");
    expect((await renderExport(result.table, "pdf")).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
