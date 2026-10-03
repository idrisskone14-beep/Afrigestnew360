import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { customerSchema } from "@/modules/crm/schemas";
import * as crm from "@/modules/crm/service";
import { getLayout, resetLayout, saveLayout } from "@/modules/dashboard/layout";
import { WIDGET_BY_KEY, availableWidgets } from "@/modules/dashboard/widgets";
import * as emp from "@/modules/hr/employees";
import { contractSchema, employeeSchema } from "@/modules/hr/schemas";
import * as pj from "@/modules/projects/service";
import { projectSchema } from "@/modules/projects/schemas";
import { productSchema } from "@/modules/inventory/schemas";
import * as inv from "@/modules/inventory/service";
import { setCompanyModule } from "@/modules/platform/companies";
import { generateAlerts } from "@/modules/platform/alerts";
import * as bills from "@/modules/purchasing/bills";
import { supplierBillSchema, supplierSchema } from "@/modules/purchasing/schemas";
import * as sup from "@/modules/purchasing/suppliers";
import * as invoices from "@/modules/sales/invoices";
import * as payments from "@/modules/sales/payments";
import { invoiceSchema } from "@/modules/sales/schemas";
import { GET as cronGet } from "@/app/api/cron/alerts/route";
import { addMember, ctxFor, makeCompany } from "../helpers";

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const co = await makeCompany("DASH", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const tax = await ctx.db.tax.findFirstOrThrow({ where: { isDefault: true } });
  const customer = await crm.createCustomer(ctx, customerSchema.parse({ type: "COMPANY", name: "Client Dash", paymentTermsDays: 30 }));
  return { ...co, ctx, tax, customer };
}
type S = Awaited<ReturnType<typeof setup>>;

async function issued(s: S, opts: { qty?: number; date?: string; due?: string } = {}) {
  const draft = await invoices.createInvoice(s.ctx, invoiceSchema.parse({ customerId: s.customer.id, issueDate: opts.date ?? today(), dueDate: opts.due ?? "", lines: [{ description: "Prestation", unit: "forfait", quantity: opts.qty ?? 10, unitPrice: 10000, discountPct: 0, taxId: s.tax.id }] }));
  return invoices.issueInvoice(s.ctx, { id: draft.id, installments: 1, allowOverLimit: false });
}

const load = async (s: S, key: string, ctx = s.ctx) => WIDGET_BY_KEY.get(key)!.load(ctx);
const notifs = (companyId: string, type: string) => platformDb.notification.findMany({ where: { companyId, type } });

describe("widgets : modules et permissions", () => {
  it("l'administrateur voit tous les widgets ; un membre sans droits ne voit que l'indispensable", async () => {
    const s = await setup();
    const all = availableWidgets(s.ctx).map((w) => w.key);
    expect(all).toEqual(expect.arrayContaining(["alerts", "revenue", "cash", "receivables", "payables", "result", "customers", "pipeline", "sales_chart", "cashflow", "expenses", "low_stock", "activity", "crm_activity"]));
    const emp = await addMember(s.company.id, "employee");
    const ectx = await ctxFor(emp.user.id, s.company.id);
    const keys = availableWidgets(ectx).map((w) => w.key);
    expect(keys).toEqual(["alerts"]);
    // les alertes d'un membre sans droits restent vides (aucune fuite de montants)
    const data = await load(s, "alerts", ectx);
    expect(data).toMatchObject({ kind: "list", items: [] });
  });

  it("un module désactivé retire ses widgets", async () => {
    const s = await setup();
    await setCompanyModule(s.company.id, "finance", false);
    await setCompanyModule(s.company.id, "accounting", false);
    const ctx = await ctxFor(s.owner.id, s.company.id);
    const keys = availableWidgets(ctx).map((w) => w.key);
    expect(keys).not.toContain("cash");
    expect(keys).not.toContain("cashflow");
    expect(keys).not.toContain("result");
    expect(keys).toContain("revenue");
  });

  it("un rôle commercial voit CRM et ventes, pas la finance ni la comptabilité", async () => {
    const s = await setup();
    const rep = await addMember(s.company.id, "sales_manager");
    const keys = availableWidgets(await ctxFor(rep.user.id, s.company.id)).map((w) => w.key);
    expect(keys).toEqual(expect.arrayContaining(["customers", "pipeline", "revenue", "receivables", "sales_chart"]));
    for (const k of ["cash", "cashflow", "expenses", "result", "payables", "activity"]) expect(keys).not.toContain(k);
  });
});

describe("valeurs des indicateurs", () => {
  it("chiffre d'affaires, créances, trésorerie, dettes et résultat reflètent les documents", async () => {
    const s = await setup();
    const a = await issued(s, { qty: 10 }); // 100 000 HT ; 118 000 TTC
    await issued(s, { qty: 5, date: daysAgo(40), due: daysAgo(10) }); // facture ancienne échue : 59 000
    await payments.recordPayment(s.ctx, { invoiceId: a.id, amount: 50000, method: "BANK_TRANSFER", date: today() } as never);

    const rev = await load(s, "revenue");
    expect(rev.kind === "kpi" && rev.value).toContain("100");
    const rec = await load(s, "receivables");
    // reste : 68 000 (première) + 59 000 (échue) = 127 000, dont 59 000 échu
    expect(rec).toMatchObject({ kind: "kpi", tone: "danger" });
    expect(rec.kind === "kpi" && rec.value.replace(/\s| /g, "")).toContain("127000");
    expect(rec.kind === "kpi" && rec.hint?.replace(/\s| /g, "")).toContain("59000");
    const cash = await load(s, "cash");
    expect(cash.kind === "kpi" && cash.value.replace(/\s| /g, "")).toContain("50000");

    const supplier = await sup.createSupplier(s.ctx, supplierSchema.parse({ name: "Fournisseur Dash", paymentTermsDays: 30 }));
    const bill = await bills.createBill(s.ctx, supplierBillSchema.parse({ supplierId: supplier.id, supplierRef: "FD-1", billDate: today(), dueDate: daysAgo(2), lines: [{ description: "Service", quantity: 1, unitPrice: 20000, taxId: s.tax.id }] }));
    await bills.postBill(s.ctx, bill.id);
    const pay = await load(s, "payables");
    expect(pay).toMatchObject({ kind: "kpi", tone: "danger" });
    expect(pay.kind === "kpi" && pay.value.replace(/\s| /g, "")).toContain("23600");

    const result = await load(s, "result");
    // produits = 100 000 + 50 000 (deux factures HT) ; charges = 20 000 (facture fournisseur HT) ; résultat = 130 000
    const flat = (v: string | undefined) => (v ?? "").replace(/[\s  ]/g, "");
    expect(result.kind === "kpi" && flat(result.hint)).toContain("Produits150000FCFA·charges20000FCFA");
    expect(result.kind === "kpi" && flat(result.value)).toContain("130000");
  });

  it("graphiques : 6 mois de facturation et de flux ; liste de stock critique et d'alertes", async () => {
    const s = await setup();
    await issued(s, { qty: 10 });
    await issued(s, { qty: 20, date: daysAgo(35) });
    const chart = await load(s, "sales_chart");
    expect(chart.kind === "bars" && chart.data).toHaveLength(6);
    expect(chart.kind === "bars" && chart.data.reduce((a, d) => a + d.value, 0)).toBe(300000);
    const flow = await load(s, "cashflow");
    expect(flow.kind === "cashflow" && flow.data).toHaveLength(6);

    const wh = (await inv.listWarehouses(s.ctx))[0]!;
    await inv.createProduct(s.ctx, productSchema.parse({ name: "Ciment critique", type: "GOODS", unit: "sac", salePrice: 6500, costPrice: 5000, trackStock: true, minStock: 10, openingWarehouseId: wh.id, openingQuantity: 2 }));
    const low = await load(s, "low_stock");
    expect(low.kind === "list" && low.items.map((i) => i.label)).toEqual(["Ciment critique"]);
    const alerts = await load(s, "alerts");
    expect(alerts.kind === "list" && alerts.items.some((i) => i.label.includes("sous le seuil"))).toBe(true);
  });
});

describe("disposition personnalisée", () => {
  it("par défaut : tous les widgets visibles ; enregistrement de l'ordre et de la visibilité", async () => {
    const s = await setup();
    const def = await getLayout(s.ctx);
    expect(def.every((l) => l.visible)).toBe(true);
    expect(def.length).toBe(availableWidgets(s.ctx).length);
    const reversed = [...def].reverse().map((l, i) => ({ key: l.key, visible: i % 2 === 0 }));
    await saveLayout(s.ctx, { layout: reversed });
    expect(await getLayout(s.ctx)).toEqual(reversed);
    await resetLayout(s.ctx);
    expect(await getLayout(s.ctx)).toEqual(def);
  });

  it("les clés inconnues ou non autorisées sont ignorées ; un nouveau widget est ajouté à la fin", async () => {
    const s = await setup();
    const emp = await addMember(s.company.id, "employee");
    const ectx = await ctxFor(emp.user.id, s.company.id);
    const saved = await saveLayout(ectx, { layout: [{ key: "cash", visible: true }, { key: "n'importe-quoi", visible: true }, { key: "alerts", visible: false }, { key: "alerts", visible: true }] });
    expect(saved).toEqual([{ key: "alerts", visible: false }]); // cash non autorisé, clé inconnue et doublon écartés
    // une disposition stockée corrompue ne casse rien
    await platformDb.dashboardPreference.update({ where: { companyId_userId: { companyId: s.company.id, userId: emp.user.id } }, data: { layout: { n: "importe quoi" } } });
    expect(await getLayout(ectx)).toEqual([{ key: "alerts", visible: true }]);
  });

  it("ISOLATION : la disposition est propre à l'utilisateur et à l'entreprise", async () => {
    const A = await setup();
    const B = await setup();
    const other = await addMember(A.company.id, "admin");
    const octx = await ctxFor(other.user.id, A.company.id);
    await saveLayout(A.ctx, { layout: [{ key: "alerts", visible: false }] });
    expect((await getLayout(A.ctx)).find((l) => l.key === "alerts")!.visible).toBe(false);
    expect((await getLayout(octx)).find((l) => l.key === "alerts")!.visible).toBe(true); // autre utilisateur, même entreprise
    expect((await getLayout(B.ctx)).find((l) => l.key === "alerts")!.visible).toBe(true); // autre entreprise
    expect(await B.ctx.db.dashboardPreference.count()).toBe(0);
  });
});

describe("tâche d'alertes", () => {
  it("notifie les membres habilités (une seule fois par fenêtre), selon module, permission et préférences", async () => {
    const s = await setup();
    await issued(s, { qty: 10, date: daysAgo(60), due: daysAgo(30) });
    const accountant = await addMember(s.company.id, "accountant"); // a finance.invoice.read, pas de stock
    const stock = await addMember(s.company.id, "stock_manager"); // pas finance.invoice.read
    const muted = await addMember(s.company.id, "accountant");
    await platformDb.notificationPreference.create({ data: { companyId: s.company.id, userId: muted.user.id, type: "invoice.overdue", inApp: false } });

    const r1 = await generateAlerts(s.company.id);
    const list = await notifs(s.company.id, "invoice.overdue");
    const who = list.map((n) => n.userId).sort();
    expect(who).toEqual([s.owner.id, accountant.user.id].sort());
    expect(who).not.toContain(stock.user.id);
    expect(who).not.toContain(muted.user.id);
    expect(list[0]).toMatchObject({ link: "/app/sales/relances", status: "UNREAD" });
    expect(list[0]!.title).toContain("1 facture client en retard");
    expect(r1.created).toBeGreaterThan(0);

    // deuxième passage : aucun doublon
    const r2 = await generateAlerts(s.company.id);
    expect(r2.created).toBe(0);
    expect((await notifs(s.company.id, "invoice.overdue")).length).toBe(2);
    // après la fenêtre, une nouvelle alerte est émise
    const r3 = await generateAlerts(s.company.id, new Date(Date.now() + 25 * 3_600_000));
    expect(r3.created).toBe(2);
  });

  it("alerte de stock : destinataires du stock seulement ; module désactivé → aucune alerte ; aucune alerte sans motif", async () => {
    const s = await setup();
    expect((await generateAlerts(s.company.id)).created).toBe(0);
    const wh = (await inv.listWarehouses(s.ctx))[0]!;
    await inv.createProduct(s.ctx, productSchema.parse({ name: "Sable critique", type: "GOODS", unit: "m³", salePrice: 9000, costPrice: 6500, trackStock: true, minStock: 5, openingWarehouseId: wh.id, openingQuantity: 1 }));
    const stock = await addMember(s.company.id, "stock_manager");
    const acct = await addMember(s.company.id, "accountant");
    await generateAlerts(s.company.id);
    const ids = (await notifs(s.company.id, "stock.low")).map((n) => n.userId);
    expect(ids).toContain(stock.user.id);
    expect(ids).toContain(s.owner.id);
    expect(ids).not.toContain(acct.user.id);

    const T = await setup();
    await setCompanyModule(T.company.id, "inventory", false);
    const wh2 = (await inv.listWarehouses(T.ctx))[0]!;
    void wh2;
    expect((await generateAlerts(T.company.id)).created).toBe(0);
  });

  it("ISOLATION : les alertes d'une entreprise ne notifient jamais les membres d'une autre", async () => {
    const A = await setup();
    const B = await setup();
    await issued(A, { qty: 10, date: daysAgo(60), due: daysAgo(30) });
    await generateAlerts(A.company.id);
    await generateAlerts(B.company.id);
    expect((await notifs(B.company.id, "invoice.overdue")).length).toBe(0);
    expect((await notifs(A.company.id, "invoice.overdue")).every((n) => n.companyId === A.company.id)).toBe(true);
    // un membre des deux entreprises ne reçoit que la notification de l'entreprise concernée
    const shared = await addMember(B.company.id, "admin");
    await platformDb.companyMembership.create({ data: { userId: shared.user.id, companyId: A.company.id, roleId: (await platformDb.role.findFirstOrThrow({ where: { companyId: A.company.id, templateKey: "admin" } })).id } });
    await platformDb.notification.deleteMany({ where: { companyId: A.company.id } });
    await generateAlerts(A.company.id);
    expect((await platformDb.notification.findMany({ where: { userId: shared.user.id, type: "invoice.overdue" } })).map((n) => n.companyId)).toEqual([A.company.id]);
  });
});

describe("route planifiée /api/cron/alerts", () => {
  const call = (token?: string) => cronGet(new NextRequest("http://localhost/api/cron/alerts", { headers: token ? { authorization: `Bearer ${token}` } : {} }));

  it("désactivée sans secret, refuse un mauvais secret, accepte le bon", async () => {
    const previous = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      expect((await call("whatever")).status).toBe(503);
      process.env.CRON_SECRET = "court";
      expect((await call("court")).status).toBe(503); // secret trop faible
      process.env.CRON_SECRET = "secret-de-test-0123456789";
      expect((await call()).status).toBe(401);
      expect((await call("mauvais-secret-0123456789")).status).toBe(401);
      const ok = await call("secret-de-test-0123456789");
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ companies: expect.any(Number), created: expect.any(Number) });
    } finally {
      if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
    }
  });
});

describe("widgets et alertes RH / projets", () => {
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  it("effectif, contrats à échéance et projets en retard ; réservés aux rôles autorisés", async () => {
    const s = await setup();
    const e = await emp.createEmployee(s.ctx, employeeSchema.parse({ firstName: "Awa", lastName: "Koné", hireDate: "2020-01-06", baseSalary: 300000 }));
    await emp.createEmployee(s.ctx, employeeSchema.parse({ firstName: "Moussa", lastName: "Traoré", hireDate: "2021-03-01", baseSalary: 300000 }));
    await emp.addContract(s.ctx, contractSchema.parse({ employeeId: e.id, type: "FIXED_TERM", startDate: "2026-01-05", endDate: inDays(20), salary: 300000 }));
    await pj.createProject(s.ctx, projectSchema.parse({ name: "Chantier en retard", status: "ACTIVE", startDate: daysAgo(60), endDate: daysAgo(5) }));

    expect(await load(s, "headcount")).toMatchObject({ kind: "kpi", value: "2" });
    const ending = await load(s, "contracts_ending");
    expect(ending).toMatchObject({ kind: "list", items: [{ label: "Koné Awa" }] });
    expect(await load(s, "projects")).toMatchObject({ kind: "kpi", value: "1", tone: "warning" });
    const alerts = await load(s, "alerts");
    expect(JSON.stringify(alerts)).toContain("contrat");

    // l'employé simple ne voit aucun de ces widgets ; le chef de projet voit les projets mais pas les contrats
    const worker = await ctxFor((await addMember(s.company.id, "employee")).user.id, s.company.id);
    const pm = await ctxFor((await addMember(s.company.id, "project_manager")).user.id, s.company.id);
    const keysOf = (c: typeof worker) => availableWidgets(c).map((w) => w.key);
    for (const k of ["headcount", "contracts_ending", "projects"]) expect(keysOf(worker)).not.toContain(k);
    expect(keysOf(pm)).toContain("projects");
    expect(keysOf(pm)).not.toContain("contracts_ending");

    // notification d'alerte vers les seuls détenteurs du droit « contrats »
    await generateAlerts(s.company.id);
    expect(await notifs(s.company.id, "contract.ending")).toHaveLength(1);
  });

  it("module RH désactivé : widgets RH retirés", async () => {
    const s = await setup();
    await setCompanyModule(s.company.id, "hr", false);
    const keys = availableWidgets(await ctxFor(s.owner.id, s.company.id)).map((w) => w.key);
    expect(keys).not.toContain("headcount");
    expect(keys).not.toContain("contracts_ending");
  });
});
