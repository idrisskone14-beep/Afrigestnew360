import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs"), os = process.getBuiltinModule("node:os"), path = process.getBuiltinModule("node:path");
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "afg-notif-"));
});

import { platformDb } from "@/core/db/client";
import { NOTIFICATION_CATALOG, flushPendingEmails, notify, usersWithPermission } from "@/core/notifications";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { customerSchema } from "@/modules/crm/schemas";
import * as crm from "@/modules/crm/service";
import { documentMetaSchema } from "@/modules/documents/schemas";
import * as docs from "@/modules/documents/service";
import * as emp from "@/modules/hr/employees";
import { employeeSchema } from "@/modules/hr/schemas";
import { generateAlerts } from "@/modules/platform/alerts";
import { projectSchema, taskSchema } from "@/modules/projects/schemas";
import * as pj from "@/modules/projects/service";
import * as invoices from "@/modules/sales/invoices";
import * as payments from "@/modules/sales/payments";
import { invoiceSchema } from "@/modules/sales/schemas";
import { addMember, ctxFor, makeCompany } from "../helpers";

const PDF = Buffer.from("%PDF-1.4\n%%EOF");
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const co = await makeCompany("NOTIF", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  return { ...co, ctx: await ctxFor(co.owner.id, co.company.id) };
}
const notifs = (companyId: string, type: string) => platformDb.notification.findMany({ where: { companyId, type }, orderBy: { createdAt: "asc" } });

describe("notify : préférences et canaux", () => {
  it("honore « dans l'application » et « e-mail » pour chaque destinataire", async () => {
    const s = await setup();
    const a = await addMember(s.company.id, "admin"), b = await addMember(s.company.id, "admin"), c = await addMember(s.company.id, "admin"), d = await addMember(s.company.id, "admin");
    await platformDb.notificationPreference.createMany({ data: [
      { companyId: s.company.id, userId: b.user.id, type: "due_date", inApp: false, email: false }, // ne veut rien
      { companyId: s.company.id, userId: c.user.id, type: "due_date", inApp: false, email: true }, // e-mail seul
      { companyId: s.company.id, userId: d.user.id, type: "due_date", inApp: true, email: true }, // les deux
    ] });
    const n = await notify(platformDb, { companyId: s.company.id, userIds: [a.user.id, b.user.id, c.user.id, d.user.id, a.user.id], type: "due_date", title: "Échéance", link: "/app/finance/echeancier" });
    expect(n).toBe(3);
    const rows = await notifs(s.company.id, "due_date");
    const by = (u: string) => rows.find((r) => r.userId === u);
    expect(by(a.user.id)).toMatchObject({ status: "UNREAD", emailPending: false });
    expect(by(b.user.id)).toBeUndefined();
    expect(by(c.user.id)).toMatchObject({ status: "READ", emailPending: true }); // jamais comptée comme non lue
    expect(by(d.user.id)).toMatchObject({ status: "UNREAD", emailPending: true });
    expect(await notify(platformDb, { companyId: s.company.id, userIds: [], type: "due_date", title: "x" })).toBe(0);
  });

  it("les e-mails en attente sont distribués une seule fois, après coup", async () => {
    const s = await setup();
    const u = await addMember(s.company.id, "admin");
    await platformDb.notificationPreference.create({ data: { companyId: s.company.id, userId: u.user.id, type: "subscription", inApp: true, email: true } });
    await notify(platformDb, { companyId: s.company.id, userIds: [u.user.id], type: "subscription", title: "Essai bientôt terminé", body: "Choisissez une offre." });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const r1 = await flushPendingEmails();
    expect(r1.sent).toBeGreaterThanOrEqual(1);
    expect(info.mock.calls.flat().join("\n")).toContain("Essai bientôt terminé");
    const row = (await notifs(s.company.id, "subscription"))[0]!;
    expect(row.emailPending).toBe(false);
    expect(row.emailedAt).toBeInstanceOf(Date);
    info.mockClear();
    const r2 = await flushPendingEmails();
    expect(r2.sent).toBe(0);
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("la notification d'une transaction annulée n'existe pas", async () => {
    const s = await setup();
    await expect(s.ctx.tx(async (tx) => {
      await notify(tx, { companyId: s.company.id, userIds: [s.owner.id], type: "task.assigned", title: "Fantôme" });
      throw new Error("annulation");
    })).rejects.toThrow("annulation");
    expect(await notifs(s.company.id, "task.assigned")).toHaveLength(0);
  });

  it("audience par permission : administrateurs et détenteurs du droit, hors utilisateur exclu", async () => {
    const s = await setup();
    const acc = await addMember(s.company.id, "accountant"), rep = await addMember(s.company.id, "sales_rep");
    const ids = await usersWithPermission(s.ctx.db, "finance.payment.read");
    expect(ids).toEqual(expect.arrayContaining([s.owner.id, acc.user.id]));
    expect(ids).not.toContain(rep.user.id);
    expect(await usersWithPermission(s.ctx.db, "finance.payment.read", s.owner.id)).not.toContain(s.owner.id);
  });

  it("catalogue : chaque type d'alerte planifiée est déclaré", () => {
    const keys: string[] = NOTIFICATION_CATALOG.map((t) => t.type);
    for (const t of ["invoice.overdue", "bill.overdue", "stock.low", "due_date", "contract.ending", "leave.request", "document.expiring", "subscription", "payment.received", "task.assigned", "approval.pending"]) expect(keys).toContain(t);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("émetteurs", () => {
  it("paiement reçu : les responsables sont prévenus, pas l'auteur", async () => {
    const s = await setup();
    const acc = await addMember(s.company.id, "accountant");
    const customer = await crm.createCustomer(s.ctx, customerSchema.parse({ type: "COMPANY", name: "Client Paiement", paymentTermsDays: 30 }));
    const tax = await s.ctx.db.tax.findFirstOrThrow({ where: { isDefault: true } });
    const draft = await invoices.createInvoice(s.ctx, invoiceSchema.parse({ customerId: customer.id, issueDate: inDays(0), lines: [{ description: "Prestation", unit: "unité", quantity: 1, unitPrice: 100000, taxId: tax.id }] } as never));
    const inv = await invoices.issueInvoice(s.ctx, { id: draft.id, installments: 1, allowOverLimit: false });
    await payments.recordPayment(s.ctx, { invoiceId: inv.id, amount: 50000, method: "BANK_TRANSFER", date: inDays(0) } as never);
    const rows = await notifs(s.company.id, "payment.received");
    expect(rows.map((r) => r.userId)).toEqual([acc.user.id]);
    expect(rows[0]!.title).toContain("Paiement reçu");
    expect(rows[0]!.link).toBe(`/app/sales/factures/${inv.id}`);
  });

  it("tâche confiée : le salarié concerné est prévenu, jamais pour sa propre affectation", async () => {
    const s = await setup();
    const worker = await addMember(s.company.id, "employee");
    const e = await emp.createEmployee(s.ctx, employeeSchema.parse({ firstName: "Awa", lastName: "Koné", hireDate: "2020-01-06", baseSalary: 300000, userId: worker.user.id }));
    const p = await pj.createProject(s.ctx, projectSchema.parse({ name: "Chantier N", status: "ACTIVE" }));
    const t = await pj.createTask(s.ctx, taskSchema.parse({ projectId: p.id, title: "Poser les fondations", assigneeId: e.id, dueDate: inDays(5) }));
    expect((await notifs(s.company.id, "task.assigned")).map((n) => n.userId)).toEqual([worker.user.id]);
    // même assigné : pas de doublon
    await pj.updateTask(s.ctx, { id: t.id, title: "Poser les fondations", status: "TODO", priority: "MEDIUM", assigneeId: e.id, estimateHours: 0 } as never);
    expect(await notifs(s.company.id, "task.assigned")).toHaveLength(1);
    // auto-affectation (le salarié est l'auteur lui-même) : aucune notification
    const mine = await emp.createEmployee(s.ctx, employeeSchema.parse({ firstName: "Moi", lastName: "Même", hireDate: "2020-01-06", baseSalary: 300000, userId: s.owner.id }));
    await pj.createTask(s.ctx, taskSchema.parse({ projectId: p.id, title: "Ma tâche", assigneeId: mine.id }));
    expect(await notifs(s.company.id, "task.assigned")).toHaveLength(1);
  });
});

describe("alertes planifiées (phase 5)", () => {
  it("échéances proches, documents expirants (au propriétaire), abonnement", async () => {
    const s = await setup();
    const hr = await ctxFor((await addMember(s.company.id, "hr")).user.id, s.company.id);
    // document du RH qui expire dans 10 jours, un autre expiré, un lointain, un sans échéance
    const mk = (name: string, expiresAt: string) => docs.createDocument(hr, documentMetaSchema.parse({ name, expiresAt }), { name: "d.pdf", size: PDF.length }, PDF);
    await mk("Assurance", inDays(10));
    await mk("Patente", inDays(-5));
    await mk("Bail", inDays(300));
    await docs.createDocument(hr, documentMetaSchema.parse({ name: "Sans échéance" }), { name: "e.pdf", size: PDF.length }, PDF);
    await expect(mk("Mauvaise date", "31/12/2026")).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    // abonnement : essai finissant dans 3 jours
    await platformDb.subscription.update({ where: { companyId: s.company.id }, data: { status: "TRIALING", trialEndsAt: new Date(Date.now() + 3 * 86_400_000) } });

    await generateAlerts(s.company.id);
    const expiring = await notifs(s.company.id, "document.expiring");
    expect(expiring.map((n) => n.userId)).toEqual([hr.user.id]); // seulement le propriétaire
    expect(expiring[0]!.title).toBe("2 documents à renouveler");
    expect(expiring[0]!.body).toContain("1 expiré");
    const sub = await notifs(s.company.id, "subscription");
    expect(sub.length).toBeGreaterThanOrEqual(1);
    expect(sub[0]!.title).toContain("essai se termine");
    expect(sub.every((n) => n.userId !== hr.user.id)).toBe(true);
    // pas de doublon au second passage
    expect((await generateAlerts(s.company.id)).created).toBe(0);
  });

  it("liste des documents à renouveler : seuls les expirés ou expirant sous 30 jours", async () => {
    const s = await setup();
    const mk = (name: string, expiresAt: string) => docs.createDocument(s.ctx, documentMetaSchema.parse({ name, expiresAt }), { name: "d.pdf", size: PDF.length }, PDF);
    await mk("Assurance", inDays(10));
    await mk("Patente", inDays(-5));
    await mk("Bail", inDays(300));
    const { rows } = await docs.listDocuments(s.ctx, { expiring: true, skip: 0, take: 20 });
    expect(rows.map((r) => r.name)).toEqual(["Patente", "Assurance"]); // le plus urgent d'abord
  });
});
