import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { customerSchema } from "@/modules/crm/schemas";
import * as crm from "@/modules/crm/service";
import { analyzeImport, previewImport, runImport } from "@/modules/data/import-service";
import { dueSchedule } from "@/modules/finance/reports";
import { supplierSchema } from "@/modules/purchasing/schemas";
import * as sup from "@/modules/purchasing/suppliers";
import * as payments from "@/modules/sales/payments";
import { ctxFor, makeCompany, makeUser } from "../helpers";

async function setup() {
  const co = await makeCompany("MIG", "enterprise");
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
const upload = (ctx: S["ctx"], entity: string, rows: string[][]) => analyzeImport(ctx, entity, { name: "import.csv", size: 1 }, csv(rows));
const run = async (ctx: S["ctx"], entity: string, rows: string[][]) => {
  const a = await upload(ctx, entity, rows);
  return { a, p: await previewImport(ctx, a.id, a.suggested) };
};
const today = () => new Date().toISOString().slice(0, 10);

describe("reprise des données d'une autre application", () => {
  it("factures clients impayées : reprises à l'état émis (numéro et dates d'origine, échéance, aucune écriture), suivies par l'échéancier, rejouables sans doublon", async () => {
    const s = await setup();
    await crm.createCustomer(s.ctx, customerSchema.parse({ type: "COMPANY", name: "Quincaillerie Koffi", paymentTermsDays: 30 }));
    const rows = [["N° facture", "Client", "Date", "Échéance", "Total HT", "Total TTC", "Reste à payer"],
      ["FA-2025-001", "Quincaillerie Koffi", "15/09/2025", "15/10/2025", "1 000 000", "1 180 000", "1 180 000"],
      ["FA-2025-002", "Quincaillerie Koffi", "01/10/2025", "", "500000", "590000", "290000"], // payée en partie
      ["FA-2025-003", "Quincaillerie Koffi", "01/10/2025", "", "", "100000", "0"], // soldée : refusée
      ["FA-2025-004", "Client Inconnu", "01/10/2025", "", "", "100000", "100000"], // client inconnu
      ["FAC-2025-00001", "Quincaillerie Koffi", "01/10/2025", "", "", "100000", "100000"]]; // numéro proche de la numérotation automatique
    const a = await upload(s.ctx, "invoices", rows);
    expect(a.suggested).toMatchObject({ number: 0, party: 1, date: 2, dueDate: 3, subtotal: 4, total: 5, balance: 6 });
    const p = await previewImport(s.ctx, a.id, a.suggested);
    expect(p).toMatchObject({ valid: 2, errors: 3, ignored: 0 });
    expect(await s.ctx.db.invoice.count()).toBe(0); // la prévisualisation n'écrit rien

    expect(await runImport(s.ctx, a.id)).toMatchObject({ created: 2, errors: 3 });
    const invs = await s.ctx.db.invoice.findMany({ orderBy: { number: "asc" }, include: { installments: true, lines: true } });
    expect(invs.map((i) => [i.number, i.status, Number(i.total), Number(i.taxTotal), Number(i.amountPaid), i.issuedAt !== null])).toEqual([
      ["FA-2025-001", "ISSUED", 1_180_000, 180_000, 0, true], ["FA-2025-002", "PARTIALLY_PAID", 590_000, 90_000, 300_000, true],
    ]);
    expect(invs[0]!.dueDate!.toISOString().slice(0, 10)).toBe("2025-10-15");
    expect(invs[1]!.dueDate!.toISOString().slice(0, 10)).toBe("2025-10-31"); // émission + délai du client
    expect(invs[1]!.installments.map((i) => [Number(i.amount), Number(i.paidAmount)])).toEqual([[590_000, 300_000]]);
    expect(invs[0]!.lines).toHaveLength(1);
    expect(await s.ctx.db.journalEntry.count()).toBe(0); // aucune écriture comptable automatique
    expect(await s.ctx.db.auditLog.count({ where: { action: "invoice.import" } })).toBe(2);

    // l'échéancier les voit par échéance (reste dû : total − réglé)
    const due = await dueSchedule(s.ctx);
    expect(due.receivables.flatMap((g) => g.rows).map((r) => r.balance).sort((x, y) => x - y)).toEqual([290_000, 1_180_000]);

    // elles reçoivent ensuite des paiements comme n'importe quelle facture
    await payments.recordPayment(s.ctx, { invoiceId: invs[1]!.id, amount: 290_000, method: "CASH", date: today() } as never);
    expect((await s.ctx.db.invoice.findFirstOrThrow({ where: { id: invs[1]!.id } })).status).toBe("PAID");

    // rejouer le fichier : les factures déjà reprises sont ignorées
    const again = await run(s.ctx, "invoices", rows);
    expect(again.p).toMatchObject({ valid: 0, ignored: 2, errors: 3 });
  });

  it("factures fournisseurs impayées : numéro d'origine gardé comme référence, numéro interne attribué, dettes suivies", async () => {
    const s = await setup();
    await sup.createSupplier(s.ctx, supplierSchema.parse({ name: "Cimenterie du Golfe", paymentTermsDays: 45 }));
    const rows = [["Référence", "Fournisseur", "Date", "Total TTC", "Déjà payé"], ["FF-884", "Cimenterie du Golfe", "02/09/2025", "590 000", "90 000"], ["FF-885", "Cimenterie du Golfe", "02/09/2025", "100000", "100000"]];
    const { a, p } = await run(s.ctx, "bills", rows);
    expect(p).toMatchObject({ valid: 1, errors: 1 }); // la seconde est déjà soldée
    await runImport(s.ctx, a.id);
    const bill = await s.ctx.db.supplierBill.findFirstOrThrow();
    expect(bill).toMatchObject({ supplierRef: "FF-884", status: "PARTIALLY_PAID" });
    expect(bill.number).toMatch(/^FF-/);
    expect([Number(bill.total), Number(bill.amountPaid)]).toEqual([590_000, 90_000]);
    expect(bill.dueDate!.toISOString().slice(0, 10)).toBe("2025-10-17");
    expect((await dueSchedule(s.ctx)).payables.flatMap((g) => g.rows).map((r) => r.balance)).toEqual([500_000]);
    expect((await run(s.ctx, "bills", rows)).p).toMatchObject({ valid: 0, ignored: 1 });
  });

  it("plan comptable puis balance d'ouverture : comptes ajoutés (existants ignorés), pièce équilibrée validée, pièce déséquilibrée écartée", async () => {
    const s = await setup();
    const plan = await run(s.ctx, "ledger", [["N° de compte", "Intitulé"], ["411100", "Clients — marchandises"], ["411", "Clients"], ["9100", "Analytique"]]);
    expect(plan.p).toMatchObject({ valid: 1, ignored: 1, errors: 1 }); // 411 existe dans le plan par défaut
    await runImport(s.ctx, plan.a.id);
    expect(await s.ctx.db.ledgerAccount.count({ where: { code: "411100" } })).toBe(1);

    const rows = [["Pièce", "Date", "Journal", "Compte", "Libellé", "Débit", "Crédit"],
      ["BAL-1", today(), "OD", "411100", "Clients", "1 000 000", ""], ["BAL-1", today(), "OD", "101", "Capital", "", "1 000 000"],
      ["BAL-2", today(), "OD", "411100", "Clients", "500", ""], ["BAL-2", today(), "OD", "101", "Capital", "", "400"], // déséquilibrée
      ["BAL-3", today(), "OD", "411100", "Clients", "10", ""], ["BAL-3", today(), "OD", "999999", "Inconnu", "", "10"]]; // une ligne en erreur
    const { a, p } = await run(s.ctx, "entries", rows);
    expect(p).toMatchObject({ valid: 2, errors: 4 });
    expect(p.preview.find((r) => r.line === 4)!.messages.join(" ")).toContain("déséquilibrée");
    expect(p.preview.find((r) => r.line === 6)!.messages.join(" ")).toContain("Pièce incomplète");
    expect(await runImport(s.ctx, a.id)).toMatchObject({ created: 1, errors: 4 }); // une pièce créée (2 lignes)
    const entry = await s.ctx.db.journalEntry.findFirstOrThrow({ where: { reference: "BAL-1" }, include: { lines: true } });
    expect(entry).toMatchObject({ status: "POSTED" });
    expect(entry.number).toMatch(/^ECR-/);
    expect(entry.lines.map((l) => [Number(l.debit), Number(l.credit)]).sort()).toEqual([[0, 1_000_000], [1_000_000, 0]]);
    expect(await s.ctx.db.journalEntry.count({ where: { reference: { in: ["BAL-2", "BAL-3"] } } })).toBe(0);
    // rejoué : la pièce déjà reprise est ignorée
    expect((await run(s.ctx, "entries", rows)).p).toMatchObject({ valid: 0, ignored: 2 });
  });

  it("application d'origine détectée, correspondance mémorisée pour le même type de fichier", async () => {
    const s = await setup();
    const header = ["Name", "Email", "Phone", "Street", "City", "Country", "Tax ID"];
    const a = await upload(s.ctx, "customers", [header, ["Odoo Client SARL", "odoo@exemple.ci", "+225 07 00 00 00 00", "Rue 12", "Abidjan", "CI", "123"]]);
    expect(a).toMatchObject({ source: "odoo", remembered: false });
    expect(a.sources.map((x) => x.key)).toContain("sage");
    expect(a.suggestions.odoo).toMatchObject({ name: 0, address: 3 });
    // l'utilisateur ne garde que le nom et l'e-mail ; la correspondance est reprise au fichier suivant (mêmes colonnes)
    await previewImport(s.ctx, a.id, { name: 0, email: 1 });
    await runImport(s.ctx, a.id);
    const b = await upload(s.ctx, "customers", [header, ["Autre Client SA", "autre@exemple.ci", "", "", "", "", ""]]);
    expect(b).toMatchObject({ remembered: true, suggested: { name: 0, email: 1 } });
    expect(b.memo).toEqual({ name: 0, email: 1 });
    // colonnes différentes : pas de reprise
    expect((await upload(s.ctx, "customers", [["Nom", "Ville"], ["X", "Y"]])).remembered).toBe(false);
  });

  it("droits : factures, comptabilité et plan exigent leur propre droit de création", async () => {
    const s = await setup();
    const onlyCrm = await memberWith(s, ["data.import.manage", "crm.customer.create"]);
    for (const e of ["invoices", "bills", "ledger", "entries"]) await expect(upload(onlyCrm.ctx, e, [["Nom"], ["X"]])).rejects.toMatchObject({ code: "FORBIDDEN" });
    const accountant = await memberWith(s, ["data.import.manage", "accounting.chart.manage"]);
    await expect(upload(accountant.ctx, "ledger", [["Compte", "Intitulé"], ["411100", "Clients"]])).resolves.toBeTruthy();
    await expect(upload(accountant.ctx, "entries", [["Pièce", "Date", "Compte"], ["P", today(), "411"]])).rejects.toMatchObject({ code: "FORBIDDEN" }); // pas le droit de saisir des écritures
  });
});
