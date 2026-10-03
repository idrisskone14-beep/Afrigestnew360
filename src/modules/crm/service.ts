import "server-only";
import { audit } from "@/core/audit";
import { businessRule, notFound } from "@/core/errors";
import { assertWithinLimit, getEffectiveLimits, getUsage } from "@/core/modules/limits";
import { d } from "@/core/money";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import type { z } from "zod";
import type {
  activitySchema, contactSchema, customerSchema, leadSchema, opportunitySchema, stageSchema, updateContactSchema, updateCustomerSchema,
  updateLeadSchema, updateOpportunitySchema, updateStageSchema,
} from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const money = (v: unknown) => (v === "" || v === undefined || v === null ? null : d(v as number).toString());
const date = (v?: string) => (v ? new Date(v) : null);
const clientErr = (m: string) => businessRule(m);

// ── Clients ───────────────────────────────────────────────────

export async function listCustomers(ctx: Ctx, p: { q?: string; skip: number; take: number; active?: boolean }) {
  const where = {
    deletedAt: null,
    ...(p.active === undefined ? {} : { isActive: p.active }),
    ...(p.q ? { OR: ["name", "code", "email", "phone", "city"].map((f) => ({ [f]: { contains: p.q, mode: "insensitive" as const } })) } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.customer.count({ where }),
    ctx.db.customer.findMany({ where, orderBy: { name: "asc" }, skip: p.skip, take: p.take, include: { _count: { select: { contacts: true } } } }),
  ]);
  return { total, rows };
}

export async function getCustomer(ctx: Ctx, id: string) {
  const c = await ctx.db.customer.findFirst({
    where: { id, deletedAt: null },
    include: { contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] } },
  });
  if (!c) throw notFound("Client");
  return c;
}

export async function createCustomer(ctx: Ctx, input: z.output<typeof customerSchema>) {
  const [limits, usage] = await Promise.all([getEffectiveLimits(ctx.company.id), getUsage(ctx.company.id)]);
  assertWithinLimit(limits, "customers", usage.customers);
  const created = await ctx.tx(async (tx) => {
    const code = await nextNumber(tx, ctx.company.id, "customer");
    return tx.customer.create({
      data: {
        companyId: ctx.company.id, code, type: input.type, name: input.name, email: blank(input.email), phone: blank(input.phone),
        address: blank(input.address), city: blank(input.city), country: blank(input.country), taxId: blank(input.taxId), rccm: blank(input.rccm),
        website: blank(input.website), paymentTermsDays: input.paymentTermsDays, creditLimit: money(input.creditLimit), notes: blank(input.notes),
        ownerId: ctx.user.id, createdById: ctx.user.id,
      },
    });
  });
  await audit(ctx, { action: "customer.create", resource: "Customer", resourceId: created.id, summary: `${ctx.user.name} a créé le client ${created.name} (${created.code}).`, after: created });
  return created;
}

export async function updateCustomer(ctx: Ctx, input: z.output<typeof updateCustomerSchema>) {
  const before = await getCustomer(ctx, input.id);
  const after = await ctx.db.customer.update({
    where: { id: input.id },
    data: {
      type: input.type, name: input.name, email: blank(input.email), phone: blank(input.phone), address: blank(input.address), city: blank(input.city),
      country: blank(input.country), taxId: blank(input.taxId), rccm: blank(input.rccm), website: blank(input.website),
      paymentTermsDays: input.paymentTermsDays, creditLimit: money(input.creditLimit), notes: blank(input.notes), isActive: input.isActive,
    },
  });
  await audit(ctx, { action: "customer.update", resource: "Customer", resourceId: after.id, summary: `${ctx.user.name} a modifié le client ${after.name} (${after.code}).`, before, after });
  return after;
}

/** Archive (suppression logique). Les hooks des modules ventes/finance peuvent la refuser s'il reste un solde. */
export async function archiveCustomer(ctx: Ctx, id: string, guards: ((ctx: Ctx, customerId: string) => Promise<void>)[] = []) {
  const c = await getCustomer(ctx, id);
  for (const g of guards) await g(ctx, id);
  await ctx.db.customer.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await audit(ctx, { action: "customer.delete", resource: "Customer", resourceId: id, summary: `${ctx.user.name} a archivé le client ${c.name} (${c.code}).`, before: c });
}

// ── Contacts ──────────────────────────────────────────────────

export async function addContact(ctx: Ctx, input: z.output<typeof contactSchema>) {
  await getCustomer(ctx, input.customerId);
  return ctx.tx(async (tx) => {
    if (input.isPrimary) await tx.contact.updateMany({ where: { customerId: input.customerId }, data: { isPrimary: false } });
    return tx.contact.create({
      data: { companyId: ctx.company.id, customerId: input.customerId, name: input.name, title: blank(input.title), email: blank(input.email), phone: blank(input.phone), isPrimary: input.isPrimary },
    });
  });
}

export async function updateContact(ctx: Ctx, input: z.output<typeof updateContactSchema>) {
  const existing = await ctx.db.contact.findFirst({ where: { id: input.id } });
  if (!existing) throw notFound("Contact");
  return ctx.tx(async (tx) => {
    if (input.isPrimary && existing.customerId) await tx.contact.updateMany({ where: { customerId: existing.customerId, id: { not: input.id } }, data: { isPrimary: false } });
    return tx.contact.update({ where: { id: input.id }, data: { name: input.name, title: blank(input.title), email: blank(input.email), phone: blank(input.phone), isPrimary: input.isPrimary } });
  });
}

export async function deleteContact(ctx: Ctx, id: string) {
  const existing = await ctx.db.contact.findFirst({ where: { id } });
  if (!existing) throw notFound("Contact");
  await ctx.db.contact.delete({ where: { id } });
}

// ── Prospects ─────────────────────────────────────────────────

export async function listLeads(ctx: Ctx, p: { q?: string; status?: "NEW" | "CONTACTED" | "QUALIFIED" | "LOST" | "CONVERTED"; skip: number; take: number }) {
  const where = {
    deletedAt: null,
    ...(p.status ? { status: p.status } : {}),
    ...(p.q ? { OR: ["name", "companyName", "email", "phone"].map((f) => ({ [f]: { contains: p.q, mode: "insensitive" as const } })) } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.lead.count({ where }),
    ctx.db.lead.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }),
  ]);
  return { total, rows };
}

export async function createLead(ctx: Ctx, input: z.output<typeof leadSchema>) {
  const lead = await ctx.db.lead.create({
    data: {
      companyId: ctx.company.id, name: input.name, companyName: blank(input.companyName), email: blank(input.email), phone: blank(input.phone),
      source: blank(input.source), estimatedValue: money(input.estimatedValue), notes: blank(input.notes), ownerId: ctx.user.id, createdById: ctx.user.id,
    },
  });
  await audit(ctx, { action: "lead.create", resource: "Lead", resourceId: lead.id, summary: `${ctx.user.name} a créé le prospect ${lead.name}.`, after: lead });
  return lead;
}

export async function updateLead(ctx: Ctx, input: z.output<typeof updateLeadSchema>) {
  const before = await ctx.db.lead.findFirst({ where: { id: input.id, deletedAt: null } });
  if (!before) throw notFound("Prospect");
  if (before.status === "CONVERTED") throw clientErr("Ce prospect a déjà été converti en client.");
  const after = await ctx.db.lead.update({
    where: { id: input.id },
    data: { name: input.name, companyName: blank(input.companyName), email: blank(input.email), phone: blank(input.phone), source: blank(input.source), estimatedValue: money(input.estimatedValue), notes: blank(input.notes), status: input.status },
  });
  await audit(ctx, { action: "lead.update", resource: "Lead", resourceId: after.id, summary: `${ctx.user.name} a modifié le prospect ${after.name}.`, before, after });
  return after;
}

export async function deleteLead(ctx: Ctx, id: string) {
  const lead = await ctx.db.lead.findFirst({ where: { id, deletedAt: null } });
  if (!lead) throw notFound("Prospect");
  await ctx.db.lead.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(ctx, { action: "lead.delete", resource: "Lead", resourceId: id, summary: `${ctx.user.name} a supprimé le prospect ${lead.name}.`, before: lead });
}

/** Conversion prospect → client (+ contact, + opportunité optionnelle) en une transaction. */
export async function convertLead(ctx: Ctx, input: { id: string; createOpportunity: boolean; opportunityTitle?: string }) {
  const lead = await ctx.db.lead.findFirst({ where: { id: input.id, deletedAt: null } });
  if (!lead) throw notFound("Prospect");
  if (lead.status === "CONVERTED") throw clientErr("Ce prospect est déjà converti.");
  const [limits, usage] = await Promise.all([getEffectiveLimits(ctx.company.id), getUsage(ctx.company.id)]);
  assertWithinLimit(limits, "customers", usage.customers);

  const result = await ctx.tx(async (tx) => {
    const code = await nextNumber(tx, ctx.company.id, "customer");
    const customer = await tx.customer.create({
      data: {
        companyId: ctx.company.id, code, type: lead.companyName ? "COMPANY" : "INDIVIDUAL", name: lead.companyName ?? lead.name, email: lead.email, phone: lead.phone,
        notes: lead.notes, ownerId: lead.ownerId ?? ctx.user.id, createdById: ctx.user.id,
      },
    });
    if (lead.companyName) {
      await tx.contact.create({ data: { companyId: ctx.company.id, customerId: customer.id, name: lead.name, email: lead.email, phone: lead.phone, isPrimary: true } });
    }
    let opportunityId: string | null = null;
    if (input.createOpportunity) {
      const stage = await tx.pipelineStage.findFirst({ where: { kind: "OPEN" }, orderBy: { position: "asc" } });
      if (!stage) throw clientErr("Aucune étape de pipeline disponible.");
      const opp = await tx.opportunity.create({
        data: {
          companyId: ctx.company.id, title: input.opportunityTitle?.trim() || `Opportunité ${customer.name}`, customerId: customer.id, leadId: lead.id, stageId: stage.id,
          amount: lead.estimatedValue ?? 0, ownerId: ctx.user.id, createdById: ctx.user.id,
        },
      });
      opportunityId = opp.id;
    }
    await tx.lead.update({ where: { id: lead.id }, data: { status: "CONVERTED", convertedCustomerId: customer.id, convertedAt: new Date() } });
    // l'historique du prospect suit le client
    await tx.activity.updateMany({ where: { leadId: lead.id }, data: { customerId: customer.id } });
    return { customer, opportunityId };
  });
  await audit(ctx, { action: "lead.convert", resource: "Lead", resourceId: lead.id, summary: `${ctx.user.name} a converti le prospect ${lead.name} en client ${result.customer.name} (${result.customer.code}).`, after: { customerId: result.customer.id } });
  return result;
}

// ── Pipeline ──────────────────────────────────────────────────

export const listStages = (ctx: Pick<Ctx, "db">) => ctx.db.pipelineStage.findMany({ orderBy: { position: "asc" } });

async function assertStageRules(ctx: Pick<Ctx, "db">, excludeId?: string, newKind?: "OPEN" | "WON" | "LOST") {
  const stages = (await listStages(ctx)).filter((s) => s.id !== excludeId);
  const kinds = new Set(stages.map((s) => s.kind));
  if (newKind) kinds.add(newKind);
  if (!kinds.has("WON") || !kinds.has("LOST") || !kinds.has("OPEN")) {
    throw clientErr("Le pipeline doit conserver au moins une étape « en cours », une étape « gagnée » et une étape « perdue ».");
  }
}

export async function createStage(ctx: Ctx, input: z.output<typeof stageSchema>) {
  const last = await ctx.db.pipelineStage.aggregate({ _max: { position: true } });
  const stage = await ctx.db.pipelineStage.create({ data: { companyId: ctx.company.id, name: input.name, probability: input.probability, kind: input.kind, position: (last._max.position ?? -1) + 1 } });
  await audit(ctx, { action: "pipeline.stage_create", resource: "PipelineStage", resourceId: stage.id, summary: `${ctx.user.name} a ajouté l'étape « ${stage.name} » au pipeline.` });
  return stage;
}

export async function updateStage(ctx: Ctx, input: z.output<typeof updateStageSchema>) {
  const before = await ctx.db.pipelineStage.findFirst({ where: { id: input.id } });
  if (!before) throw notFound("Étape");
  await assertStageRules(ctx, input.id, input.kind);
  const after = await ctx.db.pipelineStage.update({ where: { id: input.id }, data: { name: input.name, probability: input.probability, kind: input.kind } });
  // les opportunités de l'étape suivent son type
  if (before.kind !== after.kind) {
    await ctx.db.opportunity.updateMany({ where: { stageId: after.id }, data: { status: after.kind, closedAt: after.kind === "OPEN" ? null : new Date() } });
  }
  await audit(ctx, { action: "pipeline.stage_update", resource: "PipelineStage", resourceId: after.id, summary: `${ctx.user.name} a modifié l'étape « ${after.name} ».`, before, after });
  return after;
}

export async function moveStage(ctx: Ctx, input: { id: string; direction: "up" | "down" }) {
  const stages = await listStages(ctx);
  const i = stages.findIndex((s) => s.id === input.id);
  if (i < 0) throw notFound("Étape");
  const j = input.direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= stages.length) return;
  const a = stages[i]!, b = stages[j]!;
  await ctx.tx(async (tx) => {
    await tx.pipelineStage.update({ where: { id: a.id }, data: { position: b.position } });
    await tx.pipelineStage.update({ where: { id: b.id }, data: { position: a.position } });
  });
}

export async function deleteStage(ctx: Ctx, id: string) {
  const stage = await ctx.db.pipelineStage.findFirst({ where: { id }, include: { _count: { select: { opportunities: true } } } });
  if (!stage) throw notFound("Étape");
  if (stage._count.opportunities > 0) throw clientErr("Des opportunités sont dans cette étape : déplacez-les avant de la supprimer.");
  await assertStageRules(ctx, id);
  await ctx.db.pipelineStage.delete({ where: { id } });
  await audit(ctx, { action: "pipeline.stage_delete", resource: "PipelineStage", resourceId: id, summary: `${ctx.user.name} a supprimé l'étape « ${stage.name} ».` });
}

// ── Opportunités ──────────────────────────────────────────────

export async function pipelineBoard(ctx: Ctx) {
  const stages = await listStages(ctx);
  const opps = await ctx.db.opportunity.findMany({
    where: { deletedAt: null, OR: [{ status: "OPEN" }, { closedAt: { gte: new Date(Date.now() - 90 * 86_400_000) } }] },
    orderBy: { updatedAt: "desc" },
    include: { customer: { select: { id: true, name: true } }, lead: { select: { id: true, name: true } } },
  });
  return { stages, opps };
}

async function stageOf(ctx: Pick<Ctx, "db">, id: string) {
  const s = await ctx.db.pipelineStage.findFirst({ where: { id } });
  if (!s) throw notFound("Étape");
  return s;
}

async function assertRefs(ctx: Pick<Ctx, "db">, customerId?: string, leadId?: string) {
  if (customerId && !(await ctx.db.customer.findFirst({ where: { id: customerId, deletedAt: null }, select: { id: true } }))) throw notFound("Client");
  if (leadId && !(await ctx.db.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { id: true } }))) throw notFound("Prospect");
}

export async function createOpportunity(ctx: Ctx, input: z.output<typeof opportunitySchema>) {
  const stage = await stageOf(ctx, input.stageId);
  await assertRefs(ctx, input.customerId || undefined, input.leadId || undefined);
  const opp = await ctx.db.opportunity.create({
    data: {
      companyId: ctx.company.id, title: input.title, customerId: input.customerId || null, leadId: input.leadId || null, stageId: stage.id, status: stage.kind,
      amount: d(input.amount).toString(), expectedCloseDate: date(input.expectedCloseDate), notes: blank(input.notes), ownerId: ctx.user.id, createdById: ctx.user.id,
      closedAt: stage.kind === "OPEN" ? null : new Date(),
    },
  });
  await audit(ctx, { action: "opportunity.create", resource: "Opportunity", resourceId: opp.id, summary: `${ctx.user.name} a créé l'opportunité « ${opp.title} ».`, after: opp });
  return opp;
}

export async function updateOpportunity(ctx: Ctx, input: z.output<typeof updateOpportunitySchema>) {
  const before = await ctx.db.opportunity.findFirst({ where: { id: input.id, deletedAt: null } });
  if (!before) throw notFound("Opportunité");
  await assertRefs(ctx, input.customerId || undefined, input.leadId || undefined);
  const stage = await stageOf(ctx, input.stageId);
  const after = await ctx.db.opportunity.update({
    where: { id: input.id },
    data: {
      title: input.title, customerId: input.customerId || null, leadId: input.leadId || null, stageId: stage.id, status: stage.kind, amount: d(input.amount).toString(),
      expectedCloseDate: date(input.expectedCloseDate), notes: blank(input.notes), closedAt: stage.kind === "OPEN" ? null : before.closedAt ?? new Date(),
    },
  });
  await audit(ctx, { action: "opportunity.update", resource: "Opportunity", resourceId: after.id, summary: `${ctx.user.name} a modifié l'opportunité « ${after.title} ».`, before, after });
  return after;
}

export async function moveOpportunity(ctx: Ctx, input: { id: string; stageId: string; lostReason?: string }) {
  const opp = await ctx.db.opportunity.findFirst({ where: { id: input.id, deletedAt: null }, include: { stage: true } });
  if (!opp) throw notFound("Opportunité");
  const stage = await stageOf(ctx, input.stageId);
  if (stage.kind === "LOST" && !blank(input.lostReason)) throw clientErr("Indiquez le motif de la perte.");
  const after = await ctx.db.opportunity.update({
    where: { id: opp.id },
    data: { stageId: stage.id, status: stage.kind, closedAt: stage.kind === "OPEN" ? null : new Date(), lostReason: stage.kind === "LOST" ? blank(input.lostReason) : null },
  });
  await audit(ctx, { action: "opportunity.move", resource: "Opportunity", resourceId: opp.id, summary: `${ctx.user.name} a déplacé « ${opp.title} » : ${opp.stage.name} → ${stage.name}.`, before: { stage: opp.stage.name }, after: { stage: stage.name } });
  return after;
}

export async function deleteOpportunity(ctx: Ctx, id: string) {
  const opp = await ctx.db.opportunity.findFirst({ where: { id, deletedAt: null } });
  if (!opp) throw notFound("Opportunité");
  await ctx.db.opportunity.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(ctx, { action: "opportunity.delete", resource: "Opportunity", resourceId: id, summary: `${ctx.user.name} a supprimé l'opportunité « ${opp.title} ».`, before: opp });
}

// ── Activités ─────────────────────────────────────────────────

export async function listActivities(ctx: Ctx, p: { scope: "mine" | "all"; open?: boolean; customerId?: string; skip: number; take: number }) {
  const where = {
    ...(p.scope === "mine" ? { ownerId: ctx.user.id } : {}),
    ...(p.open === undefined ? {} : p.open ? { doneAt: null } : { doneAt: { not: null } }),
    ...(p.customerId ? { customerId: p.customerId } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.activity.count({ where }),
    ctx.db.activity.findMany({
      where, skip: p.skip, take: p.take, orderBy: [{ doneAt: { sort: "asc", nulls: "first" } }, { dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      include: { customer: { select: { id: true, name: true } }, lead: { select: { id: true, name: true } }, opportunity: { select: { id: true, title: true } } },
    }),
  ]);
  return { total, rows };
}

export async function createActivity(ctx: Ctx, input: z.output<typeof activitySchema>) {
  await assertRefs(ctx, input.customerId || undefined, input.leadId || undefined);
  if (input.opportunityId && !(await ctx.db.opportunity.findFirst({ where: { id: input.opportunityId }, select: { id: true } }))) throw notFound("Opportunité");
  const a = await ctx.db.activity.create({
    data: {
      companyId: ctx.company.id, type: input.type, subject: input.subject, notes: blank(input.notes), dueAt: date(input.dueAt),
      customerId: input.customerId || null, leadId: input.leadId || null, opportunityId: input.opportunityId || null, ownerId: ctx.user.id, createdById: ctx.user.id,
      // notes et appels déjà réalisés sont consignés comme faits
      doneAt: input.type === "NOTE" || (input.type !== "TASK" && !input.dueAt) ? new Date() : null,
    },
  });
  return a;
}

export async function setActivityDone(ctx: Ctx, input: { id: string; done: boolean }) {
  const a = await ctx.db.activity.findFirst({ where: { id: input.id } });
  if (!a) throw notFound("Activité");
  return ctx.db.activity.update({ where: { id: input.id }, data: { doneAt: input.done ? new Date() : null } });
}

export async function deleteActivity(ctx: Ctx, id: string) {
  const a = await ctx.db.activity.findFirst({ where: { id } });
  if (!a) throw notFound("Activité");
  await ctx.db.activity.delete({ where: { id } });
}
