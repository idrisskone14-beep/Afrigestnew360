import { describe, expect, it } from "vitest";
import { platformDb, tenantTransaction } from "@/core/db/client";
import { nextNumber } from "@/core/numbering";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import * as crm from "@/modules/crm/service";
import { customerSchema, leadSchema } from "@/modules/crm/schemas";
import { ctxFor, makeCompany, uid } from "../helpers";

const cust = (name: string) => customerSchema.parse({ type: "COMPANY", name, paymentTermsDays: 30 });

async function setup(plan = "business") {
  const co = await makeCompany("CRM", plan);
  return { ...co, ctx: await ctxFor(co.owner.id, co.company.id) };
}

describe("numérotation atomique", () => {
  it("génère des numéros uniques et continus même en parallèle", async () => {
    const { company } = await makeCompany("Num");
    const numbers = await Promise.all(Array.from({ length: 25 }, () => tenantTransaction(company.id, (tx) => nextNumber(tx, company.id, "invoice"))));
    expect(new Set(numbers).size).toBe(25);
    const year = new Date().getFullYear();
    const seqs = numbers.map((n) => Number(n.split("-")[2])).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(numbers[0]).toMatch(new RegExp(`^FAC-${year}-\\d{5}$`));
  });

  it("chaque entreprise et chaque type ont leur propre compteur ; format configurable", async () => {
    const A = await makeCompany("NumA");
    const B = await makeCompany("NumB");
    const a1 = await tenantTransaction(A.company.id, (tx) => nextNumber(tx, A.company.id, "quote"));
    await tenantTransaction(A.company.id, (tx) => nextNumber(tx, A.company.id, "quote"));
    const b1 = await tenantTransaction(B.company.id, (tx) => nextNumber(tx, B.company.id, "quote"));
    const aInv = await tenantTransaction(A.company.id, (tx) => nextNumber(tx, A.company.id, "invoice"));
    expect(a1.endsWith("-00001")).toBe(true);
    expect(b1.endsWith("-00001")).toBe(true);
    expect(aInv.endsWith("-00001")).toBe(true);
    await platformDb.numberingConfig.create({ data: { companyId: A.company.id, key: "quote", prefix: "DV", padding: 3, withYear: false } });
    expect(await tenantTransaction(A.company.id, (tx) => nextNumber(tx, A.company.id, "quote"))).toBe("DV-003");
  });

  it("une transaction annulée ne consomme pas de numéro", async () => {
    const { company } = await makeCompany("NumRb");
    await expect(tenantTransaction(company.id, async (tx) => { await nextNumber(tx, company.id, "order"); throw new Error("boom"); })).rejects.toThrow("boom");
    expect((await tenantTransaction(company.id, (tx) => nextNumber(tx, company.id, "order"))).endsWith("-00001")).toBe(true);
  });
});

describe("valeurs par défaut d'une entreprise", () => {
  it("crée taxes et pipeline, de façon idempotente", async () => {
    const { company } = await makeCompany("Def");
    await platformDb.$transaction(async (tx) => { await ensureCompanyDefaults(tx as never, company.id, "CI"); });
    const taxes = await platformDb.tax.findMany({ where: { companyId: company.id } });
    expect(taxes).toHaveLength(2);
    expect(taxes.find((t) => t.isDefault)?.rate.toString()).toBe("18");
    const stages = await platformDb.pipelineStage.findMany({ where: { companyId: company.id }, orderBy: { position: "asc" } });
    expect(stages.map((s) => s.name)).toEqual(["Nouveau", "Contacté", "Qualifié", "Proposition", "Négociation", "Gagné", "Perdu"]);
    expect(stages.map((s) => s.kind).filter((k) => k !== "OPEN")).toEqual(["WON", "LOST"]);
  });
});

describe("CRM — clients", () => {
  it("crée, numérote, liste, modifie et archive ; audit écrit", async () => {
    const { ctx } = await setup();
    const a = await crm.createCustomer(ctx, cust("ACME SARL"));
    const b = await crm.createCustomer(ctx, cust("Beta SA"));
    expect(a.code).toMatch(/^CLI-\d{5}$/);
    expect(b.code).not.toBe(a.code);
    const list = await crm.listCustomers(ctx, { q: "acme", skip: 0, take: 20 });
    expect(list.rows.map((r) => r.id)).toEqual([a.id]);
    await crm.updateCustomer(ctx, { ...customerSchema.parse({ type: "COMPANY", name: "ACME Holding", paymentTermsDays: 45 }), id: a.id, isActive: true });
    expect((await crm.getCustomer(ctx, a.id)).paymentTermsDays).toBe(45);
    await crm.archiveCustomer(ctx, a.id);
    await expect(crm.getCustomer(ctx, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const logs = await platformDb.auditLog.findMany({ where: { companyId: ctx.company.id, resourceId: a.id } });
    expect(logs.map((l) => l.action).sort()).toEqual(["customer.create", "customer.delete", "customer.update"]);
  });

  it("respecte la limite de clients de l'offre", async () => {
    const { ctx, company } = await setup("starter");
    await platformDb.usageLimit.create({ data: { companyId: company.id, key: "customers", value: 2 } });
    await crm.createCustomer(ctx, cust("C1"));
    await crm.createCustomer(ctx, cust("C2"));
    await expect(crm.createCustomer(ctx, cust("C3"))).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    // un client archivé libère de la place
    const first = (await crm.listCustomers(ctx, { skip: 0, take: 5 })).rows[0]!;
    await crm.archiveCustomer(ctx, first.id);
    await crm.createCustomer(ctx, cust("C3"));
  });

  it("ISOLATION : ni lecture, ni modification, ni archivage, ni contact sur le client d'une autre entreprise", async () => {
    const A = await setup();
    const B = await setup();
    const victim = await crm.createCustomer(B.ctx, cust("Client de B"));
    await expect(crm.getCustomer(A.ctx, victim.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(crm.updateCustomer(A.ctx, { ...customerSchema.parse({ type: "COMPANY", name: "Piraté", paymentTermsDays: 0 }), id: victim.id, isActive: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(crm.archiveCustomer(A.ctx, victim.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(crm.addContact(A.ctx, { customerId: victim.id, name: "Intrus", isPrimary: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await crm.listCustomers(A.ctx, { skip: 0, take: 50 })).rows).toHaveLength(0);
    expect((await platformDb.customer.findUniqueOrThrow({ where: { id: victim.id } })).name).toBe("Client de B");
  });

  it("contacts : un seul contact principal à la fois", async () => {
    const { ctx } = await setup();
    const c = await crm.createCustomer(ctx, cust("Contacts SARL"));
    const c1 = await crm.addContact(ctx, { customerId: c.id, name: "Awa", isPrimary: true });
    const c2 = await crm.addContact(ctx, { customerId: c.id, name: "Moussa", isPrimary: true });
    const contacts = (await crm.getCustomer(ctx, c.id)).contacts;
    expect(contacts.filter((x) => x.isPrimary).map((x) => x.id)).toEqual([c2.id]);
    await crm.updateContact(ctx, { id: c1.id, name: "Awa", isPrimary: true });
    expect((await crm.getCustomer(ctx, c.id)).contacts.filter((x) => x.isPrimary).map((x) => x.id)).toEqual([c1.id]);
    await crm.deleteContact(ctx, c2.id);
    expect((await crm.getCustomer(ctx, c.id)).contacts).toHaveLength(1);
  });
});

describe("CRM — prospects, pipeline, opportunités, activités", () => {
  it("convertit un prospect en client avec contact et opportunité ; historique transféré", async () => {
    const { ctx } = await setup();
    await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, ctx.company.id, "CI"));
    const lead = await crm.createLead(ctx, leadSchema.parse({ name: "Fatou Diop", companyName: "Diop Négoce", email: "f@diop.sn", estimatedValue: 2_500_000 }));
    await crm.createActivity(ctx, { type: "CALL", subject: "Premier appel", leadId: lead.id } as never);
    const res = await crm.convertLead(ctx, { id: lead.id, createOpportunity: true });
    expect(res.customer.name).toBe("Diop Négoce");
    expect(res.customer.code).toMatch(/^CLI-/);
    const full = await crm.getCustomer(ctx, res.customer.id);
    expect(full.contacts[0]).toMatchObject({ name: "Fatou Diop", isPrimary: true });
    const opp = await platformDb.opportunity.findUniqueOrThrow({ where: { id: res.opportunityId! }, include: { stage: true } });
    expect(opp.stage.name).toBe("Nouveau");
    expect(Number(opp.amount)).toBe(2_500_000);
    expect((await platformDb.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("CONVERTED");
    expect((await platformDb.activity.findFirstOrThrow({ where: { leadId: lead.id } })).customerId).toBe(res.customer.id);
    await expect(crm.convertLead(ctx, { id: lead.id, createOpportunity: false })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(crm.updateLead(ctx, { ...leadSchema.parse({ name: "Xyz" }), id: lead.id, status: "NEW" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("le pipeline garde au moins une étape en cours, gagnée et perdue ; réordonnable", async () => {
    const { ctx } = await setup();
    await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, ctx.company.id, "CI"));
    const stages = await crm.listStages(ctx);
    const won = stages.find((s) => s.kind === "WON")!;
    const lost = stages.find((s) => s.kind === "LOST")!;
    await expect(crm.deleteStage(ctx, won.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(crm.updateStage(ctx, { id: lost.id, name: "Perdu", probability: 0, kind: "OPEN" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const extra = await crm.createStage(ctx, { name: "Signature", probability: 90, kind: "OPEN" });
    expect(extra.position).toBe(stages.length);
    await crm.moveStage(ctx, { id: extra.id, direction: "up" });
    const after = await crm.listStages(ctx);
    expect(after.at(-2)!.id).toBe(extra.id);
    await crm.deleteStage(ctx, extra.id);
  });

  it("déplacer une opportunité met à jour son statut ; la perte exige un motif ; étape non vide non supprimable", async () => {
    const { ctx } = await setup();
    await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, ctx.company.id, "CI"));
    const stages = await crm.listStages(ctx);
    const first = stages[0]!;
    const customer = await crm.createCustomer(ctx, cust("Opp SARL"));
    const opp = await crm.createOpportunity(ctx, { title: "Contrat annuel", customerId: customer.id, stageId: first.id, amount: 5_000_000 } as never);
    expect(opp.status).toBe("OPEN");
    await expect(crm.deleteStage(ctx, first.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const lost = stages.find((s) => s.kind === "LOST")!;
    await expect(crm.moveOpportunity(ctx, { id: opp.id, stageId: lost.id })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const moved = await crm.moveOpportunity(ctx, { id: opp.id, stageId: lost.id, lostReason: "Prix trop élevé" });
    expect(moved).toMatchObject({ status: "LOST", lostReason: "Prix trop élevé" });
    expect(moved.closedAt).not.toBeNull();
    const won = stages.find((s) => s.kind === "WON")!;
    expect(await crm.moveOpportunity(ctx, { id: opp.id, stageId: won.id })).toMatchObject({ status: "WON", lostReason: null });
    const board = await crm.pipelineBoard(ctx);
    expect(board.opps.find((o) => o.id === opp.id)?.customer?.name).toBe("Opp SARL");
  });

  it("opportunités et activités ne peuvent référencer que des objets de la même entreprise", async () => {
    const A = await setup();
    const B = await setup();
    await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, A.company.id, "CI"));
    await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, B.company.id, "CI"));
    const stageA = (await crm.listStages(A.ctx))[0]!;
    const stageB = (await crm.listStages(B.ctx))[0]!;
    const custB = await crm.createCustomer(B.ctx, cust("Client B"));
    await expect(crm.createOpportunity(A.ctx, { title: "X", customerId: custB.id, stageId: stageA.id, amount: 1 } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(crm.createOpportunity(A.ctx, { title: "X", stageId: stageB.id, amount: 1 } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(crm.createActivity(A.ctx, { type: "NOTE", subject: "Note", customerId: custB.id } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const oppB = await crm.createOpportunity(B.ctx, { title: "Opp B", stageId: stageB.id, amount: 10 } as never);
    await expect(crm.moveOpportunity(A.ctx, { id: oppB.id, stageId: stageA.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(crm.deleteOpportunity(A.ctx, oppB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("activités : relances à faire, terminées, personnelles vs toutes", async () => {
    const { ctx } = await setup();
    const c = await crm.createCustomer(ctx, cust("Act SARL"));
    const due = new Date(Date.now() - 86_400_000).toISOString();
    const task = await crm.createActivity(ctx, { type: "TASK", subject: "Relancer le devis", dueAt: due, customerId: c.id } as never);
    const note = await crm.createActivity(ctx, { type: "NOTE", subject: "Note interne", customerId: c.id } as never);
    expect(task.doneAt).toBeNull();
    expect(note.doneAt).not.toBeNull();
    expect((await crm.listActivities(ctx, { scope: "mine", open: true, skip: 0, take: 10 })).rows.map((r) => r.id)).toEqual([task.id]);
    await crm.setActivityDone(ctx, { id: task.id, done: true });
    expect((await crm.listActivities(ctx, { scope: "all", open: true, skip: 0, take: 10 })).total).toBe(0);
    expect((await crm.listActivities(ctx, { scope: "all", customerId: c.id, skip: 0, take: 10 })).total).toBe(2);
    await crm.deleteActivity(ctx, note.id);
    void uid;
  });
});

describe("CRM — saisie facultative", () => {
  it("un plafond de crédit ou une valeur estimée vide reste NULL (jamais 0)", async () => {
    const { ctx } = await setup();
    const c = await crm.createCustomer(ctx, customerSchema.parse({ type: "COMPANY", name: "Sans plafond", paymentTermsDays: 30, creditLimit: "" }));
    expect(c.creditLimit).toBeNull();
    const withLimit = await crm.createCustomer(ctx, customerSchema.parse({ type: "COMPANY", name: "Avec plafond", paymentTermsDays: 30, creditLimit: "500000" }));
    expect(Number(withLimit.creditLimit)).toBe(500000);
    const lead = await crm.createLead(ctx, leadSchema.parse({ name: "Sans valeur", estimatedValue: "" }));
    expect(lead.estimatedValue).toBeNull();
  });
});
