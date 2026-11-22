import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import * as acc from "@/modules/accounting/service";
import { countPendingIntegration, integrateFneRegistry } from "@/modules/sales/fne/integrate";
import { importFneRegistry } from "@/modules/sales/fne/registry";
import { exportOf } from "../fne-export";
import { ctxFor, makeCompany, uid } from "../helpers";

async function setup(label: string) {
  const co = await makeCompany(label, "business");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  return { ...co, ctx: await ctxFor(co.owner.id, co.company.id) };
}

describe("intégration du registre FNE aux ventes", () => {
  it("crée clients, factures et avoirs ; à encaisser, sans échéance ; marqués certifiés ; jamais de doublon à la relance", async () => {
    const s = await setup("FNEINT");
    const ncc1 = `N${uid()}`, ncc2 = `M${uid()}`;
    const f1 = `F${uid()}`, f2 = `F${uid()}`, f3 = `F${uid()}`, av = `A${uid()}`;
    // un client existe déjà avec ce NCC : il doit être réutilisé, pas recréé
    const old = await s.ctx.db.customer.create({ data: { companyId: s.company.id, code: `OLD-${uid()}`, name: "ANCIEN NOM", taxId: ncc1 } });

    await importFneRegistry(s.ctx, { name: "e.xlsx" }, await exportOf([
      { ref: f1, ncc: ncc1, client: "CLIENT UN", date: "2026-03-10T10:00:00Z", ht: 1000000, vat: 180000, ttc: 1180000, pay: "transfer" },
      { ref: f2, ncc: ncc2, client: "CLIENT DEUX", date: "2026-03-12T10:00:00Z", ht: 500000, vat: 45000, ttc: 545000 }, // TVA à 9 %
      { ref: f3, ncc: ncc2, client: "CLIENT DEUX", date: "2026-04-01T10:00:00Z", ht: 200000, vat: 0, ttc: 200000 }, // exonérée
      { ref: av, sub: "refund", initial: f1, ncc: ncc1, client: "CLIENT UN", date: "2026-03-20T10:00:00Z", ht: -100000, vat: -18000, ttc: -118000 },
      { ref: `P${uid()}`, sub: "proforma", ht: 9000, vat: 0, ttc: 9000 },
    ]));
    expect(await countPendingIntegration(s.ctx)).toEqual({ invoices: 3, refunds: 1, proformas: 1 });

    const r = await integrateFneRegistry(s.ctx);
    expect(r).toMatchObject({ invoicesCreated: 3, creditNotesCreated: 1, customersCreated: 1, customersMatched: 1, refundsWithoutInvoice: 0, amountsToCheck: 0, remaining: 0 });

    // clients : l'ancien est réutilisé (et laissé tel quel), un seul nouveau est créé
    expect(await s.ctx.db.customer.count({ where: { taxId: ncc1 } })).toBe(1);
    const created = await s.ctx.db.customer.findFirstOrThrow({ where: { taxId: ncc2 } });
    expect(created).toMatchObject({ name: "CLIENT DEUX", type: "COMPANY" });
    expect(created.code).toMatch(/^CLI-/);

    // facture : numéro FNE, émise, à encaisser, sans échéance, certifiée, marquée comme reprise
    const i1 = await s.ctx.db.invoice.findFirstOrThrow({ where: { number: f1 }, include: { lines: true } });
    expect(i1).toMatchObject({ status: "ISSUED", customerId: old.id, dueDate: null, fneStatus: "CERTIFIED", fneReference: f1, fnePaymentMethod: "transfer", importSource: "fne_export", kind: "STANDARD" });
    expect([Number(i1.subtotal), Number(i1.taxTotal), Number(i1.total), Number(i1.amountPaid), Number(i1.creditedAmount)]).toEqual([1000000, 180000, 1180000, 0, 118000]);
    expect(i1.sentAt).not.toBeNull(); // déjà chez la DGI : jamais comptée « non envoyée »
    expect(i1.lines).toHaveLength(1);
    expect(i1.lines[0]).toMatchObject({ description: `Facture FNE n° ${f1}` });
    expect([Number(i1.lines[0]!.taxRate), Number(i1.lines[0]!.total)]).toEqual([18, 1180000]);
    expect(Number((await s.ctx.db.invoiceLine.findFirstOrThrow({ where: { invoice: { number: f2 } } })).taxRate)).toBe(9);
    expect(Number((await s.ctx.db.invoiceLine.findFirstOrThrow({ where: { invoice: { number: f3 } } })).taxRate)).toBe(0);

    // avoir rattaché à sa facture d'origine, en positif
    const cn = await s.ctx.db.creditNote.findFirstOrThrow({ where: { number: av } });
    expect(cn).toMatchObject({ invoiceId: i1.id, status: "ISSUED", fneStatus: "CERTIFIED", importSource: "fne_export", customerId: old.id });
    expect(Number(cn.total)).toBe(118000);

    // aucun effet de bord : ni encaissement, ni échéancier, ni écriture comptable
    expect(await s.ctx.db.payment.count()).toBe(0);
    expect(await s.ctx.db.invoiceInstallment.count()).toBe(0);
    expect(await s.ctx.db.journalEntry.count()).toBe(0);
    // les proformas ne sont pas des ventes
    expect(await s.ctx.db.invoice.count()).toBe(3);

    // le registre sait ce qu'il a intégré
    expect(await s.ctx.db.fneRegistryEntry.count({ where: { integratedAt: null, kind: { not: "PROFORMA" } } })).toBe(0);
    expect(await countPendingIntegration(s.ctx)).toEqual({ invoices: 0, refunds: 0, proformas: 1 });

    // relance : rien de créé de plus
    const again = await integrateFneRegistry(s.ctx);
    expect(again).toMatchObject({ invoicesCreated: 0, creditNotesCreated: 0, customersCreated: 0 });
    expect(await s.ctx.db.invoice.count()).toBe(3);
    expect(await s.ctx.db.creditNote.count()).toBe(1);
  });

  it("le rattrapage comptable ne comptabilise jamais ces factures reprises", async () => {
    const s = await setup("FNEACC");
    await importFneRegistry(s.ctx, { name: "e.xlsx" }, await exportOf([
      { ref: `F${uid()}`, ht: 100000, vat: 18000, ttc: 118000 },
      { ref: `A${uid()}`, sub: "refund", initial: "x", ht: -1, vat: 0, ttc: -1 },
    ]));
    await integrateFneRegistry(s.ctx);
    const r = await acc.generateMissingEntries(s.ctx);
    expect(r.errors).toEqual([]);
    expect(r.created).toBe(0);
    expect(await s.ctx.db.journalEntry.count()).toBe(0);
  });

  it("rattache une facture déjà présente dans les ventes (certifiée depuis Global Gest) au lieu de la doubler", async () => {
    const s = await setup("FNELINK");
    const ref = `F${uid()}`;
    const customer = await s.ctx.db.customer.create({ data: { companyId: s.company.id, code: `C-${uid()}`, name: "DEJA LA", taxId: "T1" } });
    const own = await s.ctx.db.invoice.create({
      data: { companyId: s.company.id, number: `FAC-2026-${uid()}`, customerId: customer.id, status: "ISSUED", currency: "XOF", issueDate: new Date("2026-05-01T00:00:00Z"), total: "1180", fneStatus: "CERTIFIED", fneReference: ref },
    });
    await importFneRegistry(s.ctx, { name: "e.xlsx" }, await exportOf([{ ref, ncc: "T1", client: "DEJA LA", ht: 1000, vat: 180, ttc: 1180 }]));
    const r = await integrateFneRegistry(s.ctx);
    expect(r).toMatchObject({ invoicesCreated: 0, invoicesLinked: 1, customersCreated: 0, remaining: 0 });
    expect(await s.ctx.db.invoice.count()).toBe(1);
    expect((await s.ctx.db.fneRegistryEntry.findFirstOrThrow({ where: { reference: ref } })).invoiceId).toBe(own.id);
  });

  it("laisse de côté un avoir dont la facture d'origine est inconnue, puis le rattache quand elle arrive", async () => {
    const s = await setup("FNEORPH");
    const orig = `F${uid()}`, av = `A${uid()}`;
    await importFneRegistry(s.ctx, { name: "recent.xlsx" }, await exportOf([{ ref: av, sub: "refund", initial: orig, ht: -1000, vat: -180, ttc: -1180 }]));
    const first = await integrateFneRegistry(s.ctx);
    expect(first).toMatchObject({ creditNotesCreated: 0, refundsWithoutInvoice: 1, remaining: 1 });
    expect(await s.ctx.db.creditNote.count()).toBe(0);

    // un export plus ancien apporte la facture : l'avoir peut alors être rattaché
    await importFneRegistry(s.ctx, { name: "ancien.xlsx" }, await exportOf([{ ref: orig, ht: 1000, vat: 180, ttc: 1180 }]));
    const second = await integrateFneRegistry(s.ctx);
    expect(second).toMatchObject({ invoicesCreated: 1, creditNotesCreated: 1, refundsWithoutInvoice: 0, remaining: 0 });
    expect(Number((await s.ctx.db.invoice.findFirstOrThrow({ where: { number: orig } })).creditedAmount)).toBe(1180);
  });

  it("signale un document dont HT + TVA ne retombe pas sur le TTC, et garde un avoir sans numéro FNE propre", async () => {
    const s = await setup("FNECHK");
    const orig = `F${uid()}`;
    await importFneRegistry(s.ctx, { name: "e.xlsx" }, await exportOf([
      { ref: orig, ht: 1000, vat: 180, ttc: 1500 }, // incohérent
      { ref: "", sub: "refund", initial: orig, date: "2026-02-17T15:08:11.414Z", ht: -400, vat: -72, ttc: -472 },
    ]));
    const r = await integrateFneRegistry(s.ctx);
    expect(r).toMatchObject({ invoicesCreated: 1, creditNotesCreated: 1, amountsToCheck: 1 });
    const cn = await s.ctx.db.creditNote.findFirstOrThrow({});
    expect(cn.number).toMatch(/^SANS-NUMERO-/);
    expect(cn.fneReference).toBeNull(); // pas de faux numéro FNE affiché
  });

  it("chaque entreprise garde ses clients et ses factures : même numéro FNE possible ailleurs, aucune fuite", async () => {
    const A = await setup("FNEA2");
    const B = await setup("FNEB2");
    const shared = `F${uid()}`;
    await importFneRegistry(A.ctx, { name: "a.xlsx" }, await exportOf([{ ref: shared, ncc: "COMMUN", client: "CLIENT A", ht: 100, vat: 18, ttc: 118 }]));
    await integrateFneRegistry(A.ctx);
    expect(await B.ctx.db.invoice.count()).toBe(0);
    expect(await B.ctx.db.customer.count()).toBe(0);
    await importFneRegistry(B.ctx, { name: "b.xlsx" }, await exportOf([{ ref: shared, ncc: "COMMUN", client: "CLIENT B", ht: 900, vat: 162, ttc: 1062 }]));
    await integrateFneRegistry(B.ctx);
    expect(Number((await A.ctx.db.invoice.findFirstOrThrow({ where: { number: shared } })).total)).toBe(118);
    expect(Number((await B.ctx.db.invoice.findFirstOrThrow({ where: { number: shared } })).total)).toBe(1062);
    expect((await A.ctx.db.customer.findFirstOrThrow({})).name).toBe("CLIENT A");
    expect((await B.ctx.db.customer.findFirstOrThrow({})).name).toBe("CLIENT B");
  });
});
