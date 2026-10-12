import { beforeEach, describe, expect, it, vi } from "vitest";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import * as crm from "@/modules/crm/service";
import { customerSchema } from "@/modules/crm/schemas";
import { runAllDueRecurring } from "@/modules/platform/recurring-runner";
import * as invoices from "@/modules/sales/invoices";
import { createRecurringFromInvoice, nextOccurrence, recurringFromInvoiceSchema, runRecurring, setRecurringStatus, getRecurring } from "@/modules/sales/recurring";
import { invoiceSchema, type LineInput } from "@/modules/sales/schemas";
import { ctxFor, makeCompany } from "../helpers";

const sent: { to: string }[] = [];
vi.mock("@/core/mail", async (orig) => ({ ...(await orig<typeof import("@/core/mail")>()), sendMail: async (m: { to: string }) => { sent.push(m); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayDate = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
const monthsAgo = (n: number) => { const t = todayDate(); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - n, 1)); };

async function setup(email = "client@rec.ci") {
  const co = await makeCompany("RECURRENT");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const tax = await ctx.db.tax.findFirstOrThrow({ where: { isDefault: true } });
  const customer = await crm.createCustomer(ctx, customerSchema.parse({ type: "COMPANY", name: "Client Récurrent", ...(email ? { email } : {}), paymentTermsDays: 30 }));
  const line: LineInput = { productId: "", description: "Abonnement maintenance", unit: "mois", quantity: 1, unitPrice: 25000, discountPct: 0, taxId: tax.id };
  const invoice = () => invoices.createInvoice(ctx, invoiceSchema.parse({ customerId: customer.id, issueDate: iso(todayDate()), dueDate: "", notes: "Note", terms: "30 jours", lines: [line] }));
  const template = async (over: Record<string, unknown> = {}) => {
    const inv = await invoice();
    return createRecurringFromInvoice(ctx, recurringFromInvoiceSchema.parse({ invoiceId: inv.id, title: "Maintenance mensuelle", frequency: "MONTHLY", nextRunDate: iso(todayDate()), endDate: "", autoIssue: false, autoSend: false, ...over }));
  };
  return { ...co, ctx, tax, customer, template, invoice };
}

beforeEach(() => { sent.length = 0; });

describe("calendrier", () => {
  it("garde le jour du mois visé et ramène à la fin des mois plus courts", () => {
    const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
    expect(iso(nextOccurrence(d("2026-01-31"), "MONTHLY", 31))).toBe("2026-02-28");
    expect(iso(nextOccurrence(d("2026-02-28"), "MONTHLY", 31))).toBe("2026-03-31");
    expect(iso(nextOccurrence(d("2026-11-30"), "QUARTERLY", 30))).toBe("2027-02-28");
    expect(iso(nextOccurrence(d("2026-03-15"), "SEMIANNUAL", 15))).toBe("2026-09-15");
    expect(iso(nextOccurrence(d("2028-02-29"), "YEARLY", 29))).toBe("2029-02-28");
    expect(iso(nextOccurrence(d("2026-12-10"), "MONTHLY", 10))).toBe("2027-01-10");
  });
});

describe("modèles de factures récurrentes", () => {
  it("copie les lignes d'une facture (hors déductions d'acompte) et refuse un acompte ou une facture annulée", async () => {
    const s = await setup();
    const rec = await s.template();
    expect(rec.lines).toHaveLength(1);
    expect(rec.anchorDay).toBe(todayDate().getUTCDate());
    expect(rec.notes).toBe("Note");
    const dep = await s.invoice();
    await s.ctx.db.invoice.update({ where: { id: dep.id }, data: { kind: "DEPOSIT" } });
    await expect(createRecurringFromInvoice(s.ctx, recurringFromInvoiceSchema.parse({ invoiceId: dep.id, title: "Acompte", frequency: "MONTHLY", nextRunDate: iso(todayDate()), autoIssue: false, autoSend: false }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(s.template({ endDate: iso(new Date(Date.now() - 40 * DAY)) })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("génère un brouillon à l'échéance, relié au modèle, et avance le calendrier", async () => {
    const s = await setup();
    const rec = await s.template();
    const res = await runRecurring(s.ctx, rec.id);
    expect(res.generated).toBe(1);
    const inv = await invoices.getInvoice(s.ctx, res.invoiceIds[0]!);
    expect(inv.status).toBe("DRAFT");
    expect(inv.recurringId).toBe(rec.id);
    expect(Number(inv.total)).toBe(29500);
    expect(inv.notes).toBe("Note");
    const after = await getRecurring(s.ctx, rec.id);
    expect(after.runCount).toBe(1);
    expect(iso(after.nextRunDate)).toBe(iso(nextOccurrence(todayDate(), "MONTHLY", rec.anchorDay)));
    // rien de plus à générer avant la prochaine échéance
    expect((await runRecurring(s.ctx, rec.id)).generated).toBe(0);
  });

  it("émet la facture et l'envoie quand le modèle le demande ; signale l'absence d'adresse e-mail", async () => {
    const s = await setup();
    const rec = await s.template({ autoIssue: true, autoSend: true });
    const res = await runRecurring(s.ctx, rec.id);
    const inv = await invoices.getInvoice(s.ctx, res.invoiceIds[0]!);
    expect(inv.status).toBe("ISSUED");
    expect(inv.number).not.toBeNull();
    expect(inv.sentAt).not.toBeNull();
    expect(sent.map((m) => m.to)).toEqual(["client@rec.ci"]);

    const noMail = await setup("");
    const rec2 = await noMail.template({ autoIssue: true, autoSend: true });
    const res2 = await runRecurring(noMail.ctx, rec2.id);
    expect(res2.generated).toBe(1);
    expect(res2.warnings[0]).toContain("adresse e-mail");
    expect((await getRecurring(noMail.ctx, rec2.id)).lastError).toContain("adresse e-mail");
  });

  it("rattrape les échéances manquées, datées à leur échéance, sans dépasser aujourd'hui", async () => {
    const s = await setup();
    const rec = await s.template({ nextRunDate: iso(monthsAgo(3)) });
    const res = await runRecurring(s.ctx, rec.id);
    expect(res.generated).toBe(4);
    const dates = (await Promise.all(res.invoiceIds.map((id) => invoices.getInvoice(s.ctx, id)))).map((i) => iso(i.issueDate)).sort();
    expect(dates[0]).toBe(iso(monthsAgo(3)));
    expect(dates.every((d) => d <= iso(todayDate()))).toBe(true);
    expect(iso((await getRecurring(s.ctx, rec.id)).nextRunDate) > iso(todayDate())).toBe(true);
  });

  it("deux exécutions simultanées ne génèrent l'échéance qu'une fois", async () => {
    const s = await setup();
    const rec = await s.template();
    const [a, b] = await Promise.all([runRecurring(s.ctx, rec.id), runRecurring(s.ctx, rec.id)]);
    expect(a.generated + b.generated).toBe(1);
    expect(await s.ctx.db.invoice.count({ where: { recurringId: rec.id } })).toBe(1);
  });

  it("s'arrête à la date de fin", async () => {
    const s = await setup();
    const rec = await s.template({ nextRunDate: iso(monthsAgo(2)), endDate: iso(monthsAgo(1)) });
    const res = await runRecurring(s.ctx, rec.id);
    expect(res.generated).toBe(2); // échéances d'il y a 2 mois et d'il y a 1 mois
    expect((await getRecurring(s.ctx, rec.id)).status).toBe("ENDED");
  });

  it("un modèle en pause ne génère rien ; un échec garde le calendrier et consigne l'erreur", async () => {
    const s = await setup();
    const paused = await s.template();
    await setRecurringStatus(s.ctx, { id: paused.id, status: "PAUSED" });
    expect((await runRecurring(s.ctx, paused.id)).generated).toBe(0);

    const rec = await s.template();
    await s.ctx.db.customer.update({ where: { id: s.customer.id }, data: { isActive: false } });
    const res = await runRecurring(s.ctx, rec.id);
    expect(res.generated).toBe(0);
    expect(res.error).toContain("inactif");
    const after = await getRecurring(s.ctx, rec.id);
    expect(iso(after.nextRunDate)).toBe(iso(todayDate()));
    expect(after.status).toBe("ACTIVE");
    expect(after.lastError).toContain("inactif");
  });

  it("génération manuelle : facture datée d'aujourd'hui et calendrier avancé d'une période", async () => {
    const s = await setup();
    const future = new Date(todayDate().getTime() + 10 * DAY);
    const rec = await s.template({ nextRunDate: iso(future) });
    expect((await runRecurring(s.ctx, rec.id)).generated).toBe(0); // pas encore échu
    const res = await runRecurring(s.ctx, rec.id, { manual: true });
    expect(res.generated).toBe(1);
    expect(iso((await invoices.getInvoice(s.ctx, res.invoiceIds[0]!)).issueDate)).toBe(iso(todayDate()));
    expect(iso((await getRecurring(s.ctx, rec.id)).nextRunDate)).toBe(iso(nextOccurrence(future, "MONTHLY", rec.anchorDay)));
  });
});

describe("tâche planifiée", () => {
  it("traite chaque entreprise dans son propre contexte et ignore les entreprises suspendues", async () => {
    const A = await setup();
    const B = await setup();
    const C = await setup();
    const ra = await A.template();
    const rb = await B.template();
    const rc = await C.template();
    await platformDb.company.update({ where: { id: C.company.id }, data: { status: "SUSPENDED" } });
    const res = await runAllDueRecurring();
    expect(res.generated).toBeGreaterThanOrEqual(2);
    const invA = await A.ctx.db.invoice.findMany({ where: { recurringId: ra.id } });
    const invB = await B.ctx.db.invoice.findMany({ where: { recurringId: rb.id } });
    expect(invA).toHaveLength(1);
    expect(invB).toHaveLength(1);
    expect(invA[0]!.companyId).toBe(A.company.id);
    expect(invB[0]!.companyId).toBe(B.company.id);
    expect(await platformDb.invoice.count({ where: { recurringId: rc.id } })).toBe(0);
    // l'isolation tient : A ne voit pas le modèle de B
    expect(await A.ctx.db.recurringInvoice.findFirst({ where: { id: rb.id } })).toBeNull();
  });
});
