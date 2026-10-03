import "server-only";
import { audit } from "@/core/audit";
import { parseDate } from "@/core/documents/lines";
import { businessRule, forbidden, notFound } from "@/core/errors";
import { d, roundMoney, type Decimal } from "@/core/money";
import { nextNumber } from "@/core/numbering";
import { notify } from "@/core/notifications";
import type { TenantContext } from "@/core/tenant/context";
import "@/modules/registry";
import { formatMoney } from "@/lib/reference-data";
import { assertOrgRefs } from "@/modules/org/service";
import { invoiceSchema } from "@/modules/sales/schemas";
import { createInvoice } from "@/modules/sales/invoices";
import type { z } from "zod";
import type { invoiceTimeSchema, moveTaskSchema, projectSchema, taskSchema, timeSchema, updateProjectSchema, updateTaskSchema, updateTimeSchema } from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const day = (v: Date) => new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
const iso = (v: Date) => v.toISOString().slice(0, 10);
/** Heures mensuelles de référence pour convertir un salaire mensuel en coût horaire (22 jours × 8 h). */
const MONTHLY_HOURS = 176;

export { assertProject } from "./refs";

// ═══ Projets ══════════════════════════════════════════════════

export async function listProjects(ctx: Ctx, p: { q?: string; status?: string; customerId?: string; skip: number; take: number }) {
  const where = {
    deletedAt: null,
    ...(p.status ? { status: p.status as never } : {}),
    ...(p.customerId ? { customerId: p.customerId } : {}),
    ...(p.q ? { OR: [{ name: { contains: p.q, mode: "insensitive" as const } }, { code: { contains: p.q, mode: "insensitive" as const } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.project.count({ where }),
    ctx.db.project.findMany({ where, orderBy: [{ createdAt: "desc" }], skip: p.skip, take: p.take, include: { customer: { select: { id: true, name: true } }, manager: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { tasks: true } } } }),
  ]);
  return { total, rows };
}

export async function getProject(ctx: Ctx, id: string) {
  const pr = await ctx.db.project.findFirst({ where: { id, deletedAt: null }, include: { customer: { select: { id: true, name: true } }, manager: { select: { id: true, firstName: true, lastName: true } } } });
  if (!pr) throw notFound("Projet");
  return pr;
}

async function checkRefs(ctx: Ctx, input: { customerId?: string | null; managerId?: string | null; branchId?: string | null; costCenterId?: string | null; startDate?: string | null; endDate?: string | null }) {
  if (input.customerId && !(await ctx.db.customer.findFirst({ where: { id: input.customerId, deletedAt: null }, select: { id: true } }))) throw notFound("Client");
  if (input.managerId && !(await ctx.db.employee.findFirst({ where: { id: input.managerId, deletedAt: null, status: "ACTIVE" }, select: { id: true } }))) throw notFound("Chef de projet");
  await assertOrgRefs(ctx.db, { branchId: input.branchId, costCenterId: input.costCenterId });
  const s = parseDate(input.startDate), e = parseDate(input.endDate);
  if (s && e && e < s) throw businessRule("La fin du projet précède son début.");
}

export async function createProject(ctx: Ctx, input: z.output<typeof projectSchema>) {
  await checkRefs(ctx, input);
  const pr = await ctx.tx(async (tx) => {
    const code = await nextNumber(tx, ctx.company.id, "project");
    return tx.project.create({
      data: {
        companyId: ctx.company.id, code, name: input.name.trim(), description: blank(input.description), customerId: input.customerId || null, managerId: input.managerId || null, status: input.status,
        startDate: parseDate(input.startDate), endDate: parseDate(input.endDate), budget: roundMoney(input.budget, ctx.company.currency).toString(), billRate: roundMoney(input.billRate, ctx.company.currency).toString(),
        branchId: input.branchId || null, costCenterId: input.costCenterId || null, createdById: ctx.user.id,
      },
    });
  });
  await audit(ctx, { action: "project.create", resource: "Project", resourceId: pr.id, summary: `${ctx.user.name} a créé le projet ${pr.code} « ${pr.name} ».` });
  return pr;
}

export async function updateProject(ctx: Ctx, input: z.output<typeof updateProjectSchema>) {
  const before = await getProject(ctx, input.id);
  await checkRefs(ctx, input);
  const after = await ctx.db.project.update({
    where: { id: input.id },
    data: {
      name: input.name.trim(), description: blank(input.description), customerId: input.customerId || null, managerId: input.managerId || null, status: input.status, startDate: parseDate(input.startDate), endDate: parseDate(input.endDate),
      budget: roundMoney(input.budget, ctx.company.currency).toString(), billRate: roundMoney(input.billRate, ctx.company.currency).toString(), branchId: input.branchId || null, costCenterId: input.costCenterId || null,
    },
  });
  await audit(ctx, { action: "project.update", resource: "Project", resourceId: after.id, summary: `${ctx.user.name} a modifié le projet ${after.code}.`, before: { budget: before.budget, status: before.status }, after: { budget: after.budget, status: after.status } });
  return after;
}

export async function setProjectStatus(ctx: Ctx, id: string, status: "PLANNED" | "ACTIVE" | "ON_HOLD" | "DONE" | "CANCELLED") {
  const pr = await getProject(ctx, id);
  if (pr.status === status) return pr;
  if (status === "DONE") {
    const open = await ctx.db.projectTask.count({ where: { projectId: id, status: { not: "DONE" } } });
    if (open > 0) throw businessRule(`${open} tâche${open > 1 ? "s" : ""} n'${open > 1 ? "ont" : "a"} pas encore été terminée${open > 1 ? "s" : ""}.`);
  }
  const after = await ctx.db.project.update({ where: { id }, data: { status } });
  await audit(ctx, { action: "project.status", resource: "Project", resourceId: id, summary: `${ctx.user.name} a passé le projet ${pr.code} de « ${pr.status} » à « ${status} ».` });
  return after;
}

export interface ProjectSummary {
  hours: Decimal; billableHours: Decimal; billedHours: Decimal; laborCost: Decimal; expensesCost: Decimal; billsCost: Decimal; totalCost: Decimal; budget: Decimal; budgetUsedPct: number | null;
  revenue: Decimal; toBill: Decimal; margin: Decimal; tasks: { total: number; done: number };
}

/**
 * Situation financière d'un projet : temps (coût figé à la saisie), dépenses payées et achats validés rattachés, produits facturés
 * et temps facturable restant à facturer. Les montants que l'utilisateur n'a pas le droit de lire sont exclus (permission par source).
 */
export async function projectSummary(ctx: Ctx, projectId: string): Promise<ProjectSummary> {
  const pr = await getProject(ctx, projectId);
  const canExp = ctx.hasModule("finance") && ctx.can("finance.expense.read");
  const canBill = ctx.hasModule("purchases") && ctx.can("purchases.bill.read");
  const canInv = ctx.hasModule("sales") && ctx.can("finance.invoice.read");
  const [time, exps, bills, invs, tasks, done] = await Promise.all([
    ctx.db.timeEntry.findMany({ where: { projectId }, select: { hours: true, billable: true, costRate: true, billRate: true, invoiceId: true } }),
    canExp ? ctx.db.expense.aggregate({ where: { projectId, status: "PAID" }, _sum: { amount: true } }) : Promise.resolve(null),
    canBill ? ctx.db.supplierBill.aggregate({ where: { projectId, status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] } }, _sum: { subtotal: true, discountTotal: true } }) : Promise.resolve(null),
    canInv ? ctx.db.invoice.aggregate({ where: { projectId, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] } }, _sum: { subtotal: true, discountTotal: true } }) : Promise.resolve(null),
    ctx.db.projectTask.count({ where: { projectId } }),
    ctx.db.projectTask.count({ where: { projectId, status: "DONE" } }),
  ]);
  const sum = (f: (t: (typeof time)[number]) => Decimal) => time.reduce((a, t) => a.plus(f(t)), d(0));
  const hours = sum((t) => d(t.hours));
  const laborCost = sum((t) => d(t.hours).mul(t.costRate));
  const expensesCost = d(exps?._sum.amount ?? 0);
  const billsCost = d(bills?._sum.subtotal ?? 0).minus(bills?._sum.discountTotal ?? 0);
  const totalCost = laborCost.plus(expensesCost).plus(billsCost);
  const revenue = d(invs?._sum.subtotal ?? 0).minus(invs?._sum.discountTotal ?? 0);
  const toBill = sum((t) => (t.billable && !t.invoiceId ? d(t.hours).mul(t.billRate) : d(0)));
  const budget = d(pr.budget);
  return {
    hours, billableHours: sum((t) => (t.billable ? d(t.hours) : d(0))), billedHours: sum((t) => (t.invoiceId ? d(t.hours) : d(0))), laborCost, expensesCost, billsCost, totalCost, budget,
    budgetUsedPct: budget.gt(0) ? totalCost.div(budget).mul(100).toDecimalPlaces(1).toNumber() : null, revenue, toBill, margin: revenue.minus(totalCost), tasks: { total: tasks, done },
  };
}

// ═══ Tâches ═══════════════════════════════════════════════════

async function openProject(ctx: Ctx, projectId: string) {
  const pr = await getProject(ctx, projectId);
  if (pr.status === "CANCELLED" || pr.status === "DONE") throw businessRule("Ce projet est clôturé : sa planification n'est plus modifiable (rouvrez-le d'abord).");
  return pr;
}

export async function listTasks(ctx: Ctx, projectId: string) {
  return ctx.db.projectTask.findMany({ where: { projectId }, orderBy: [{ status: "asc" }, { position: "asc" }, { createdAt: "asc" }], include: { assignee: { select: { id: true, firstName: true, lastName: true } }, dependsOn: { select: { id: true, title: true } } } });
}

async function taskRefs(ctx: Ctx, projectId: string, input: { assigneeId?: string | null; dependsOnId?: string | null; startDate?: string | null; dueDate?: string | null }, selfId?: string) {
  if (input.assigneeId && !(await ctx.db.employee.findFirst({ where: { id: input.assigneeId, deletedAt: null, status: "ACTIVE" }, select: { id: true } }))) throw notFound("Responsable de la tâche");
  const s = parseDate(input.startDate), e = parseDate(input.dueDate);
  if (s && e && e < s) throw businessRule("L'échéance précède le début de la tâche.");
  if (input.dependsOnId) {
    if (input.dependsOnId === selfId) throw businessRule("Une tâche ne peut pas dépendre d'elle-même.");
    if (!(await ctx.db.projectTask.findFirst({ where: { id: input.dependsOnId, projectId }, select: { id: true } }))) throw notFound("Tâche prédécesseur");
    let cur: string | null = input.dependsOnId;
    for (let i = 0; selfId && cur && i < 100; i++) {
      if (cur === selfId) throw businessRule("Cette dépendance créerait une boucle entre tâches.");
      cur = (await ctx.db.projectTask.findFirst({ where: { id: cur }, select: { dependsOnId: true } }))?.dependsOnId ?? null;
    }
  }
}

/** Prévient le salarié (s'il a un compte) qu'une tâche lui est confiée ; jamais l'auteur de l'affectation lui-même. */
async function notifyAssignee(ctx: Ctx, task: { id: string; title: string; projectId: string; assigneeId: string | null; dueDate: Date | null }) {
  if (!task.assigneeId) return;
  const e = await ctx.db.employee.findFirst({ where: { id: task.assigneeId }, select: { userId: true } });
  if (!e?.userId || e.userId === ctx.user.id) return;
  await notify(ctx.db, { companyId: ctx.company.id, userIds: [e.userId], type: "task.assigned", title: `Tâche confiée : ${task.title}`, body: task.dueDate ? `Échéance le ${iso(task.dueDate)}.` : null, link: "/app/projects/mes-taches" });
}

export async function createTask(ctx: Ctx, input: z.output<typeof taskSchema>) {
  await openProject(ctx, input.projectId);
  await taskRefs(ctx, input.projectId, input);
  const last = await ctx.db.projectTask.aggregate({ where: { projectId: input.projectId, status: input.status }, _max: { position: true } });
  const t = await ctx.db.projectTask.create({
    data: {
      companyId: ctx.company.id, projectId: input.projectId, title: input.title.trim(), description: blank(input.description), status: input.status, priority: input.priority, assigneeId: input.assigneeId || null,
      startDate: parseDate(input.startDate), dueDate: parseDate(input.dueDate), estimateHours: input.estimateHours, dependsOnId: input.dependsOnId || null, position: (last._max.position ?? -1) + 1,
      completedAt: input.status === "DONE" ? new Date() : null, createdById: ctx.user.id,
    },
  });
  await audit(ctx, { action: "project.task.create", resource: "ProjectTask", resourceId: t.id, summary: `${ctx.user.name} a créé la tâche « ${t.title} ».` });
  await notifyAssignee(ctx, t);
  return t;
}

export async function updateTask(ctx: Ctx, input: z.output<typeof updateTaskSchema>) {
  const before = await ctx.db.projectTask.findFirst({ where: { id: input.id } });
  if (!before) throw notFound("Tâche");
  await openProject(ctx, before.projectId);
  await taskRefs(ctx, before.projectId, input, input.id);
  const t = await ctx.db.projectTask.update({
    where: { id: input.id },
    data: {
      title: input.title.trim(), description: blank(input.description), status: input.status, priority: input.priority, assigneeId: input.assigneeId || null, startDate: parseDate(input.startDate), dueDate: parseDate(input.dueDate),
      estimateHours: input.estimateHours, dependsOnId: input.dependsOnId || null, completedAt: input.status === "DONE" ? before.completedAt ?? new Date() : null,
    },
  });
  await audit(ctx, { action: "project.task.update", resource: "ProjectTask", resourceId: t.id, summary: `${ctx.user.name} a modifié la tâche « ${t.title} ».` });
  if (t.assigneeId !== before.assigneeId) await notifyAssignee(ctx, t);
  return t;
}

/** Changement de colonne (Kanban). Sans droit de gestion de projet, on ne déplace que ses propres tâches. */
export async function moveTask(ctx: Ctx, input: z.output<typeof moveTaskSchema>) {
  const t = await ctx.db.projectTask.findFirst({ where: { id: input.id }, include: { assignee: { select: { userId: true } } } });
  if (!t) throw notFound("Tâche");
  if (!ctx.can("project.project.update") && t.assignee?.userId !== ctx.user.id) throw forbidden("Vous ne pouvez déplacer que les tâches qui vous sont confiées.");
  await openProject(ctx, t.projectId);
  if (t.status === input.status) return t;
  const last = await ctx.db.projectTask.aggregate({ where: { projectId: t.projectId, status: input.status }, _max: { position: true } });
  const after = await ctx.db.projectTask.update({ where: { id: t.id }, data: { status: input.status, position: (last._max.position ?? -1) + 1, completedAt: input.status === "DONE" ? new Date() : null } });
  await audit(ctx, { action: "project.task.move", resource: "ProjectTask", resourceId: t.id, summary: `${ctx.user.name} a passé la tâche « ${t.title} » de « ${t.status} » à « ${input.status} ».` });
  return after;
}

export async function deleteTask(ctx: Ctx, id: string) {
  const t = await ctx.db.projectTask.findFirst({ where: { id } });
  if (!t) throw notFound("Tâche");
  await openProject(ctx, t.projectId);
  if (await ctx.db.timeEntry.count({ where: { taskId: id } })) throw businessRule("Du temps a été saisi sur cette tâche : elle ne peut pas être supprimée.");
  await ctx.db.projectTask.delete({ where: { id } });
  await audit(ctx, { action: "project.task.delete", resource: "ProjectTask", resourceId: id, summary: `${ctx.user.name} a supprimé la tâche « ${t.title} ».` });
}

export async function myTasks(ctx: Ctx) {
  const me = await ctx.db.employee.findFirst({ where: { userId: ctx.user.id, deletedAt: null }, select: { id: true } });
  if (!me) return [];
  return ctx.db.projectTask.findMany({ where: { assigneeId: me.id, status: { not: "DONE" }, project: { status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] } } }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }], include: { project: { select: { id: true, code: true, name: true } } }, take: 100 });
}

// ═══ Temps passé ══════════════════════════════════════════════

const manageTime = (ctx: Pick<Ctx, "can">) => ctx.can("project.time.manage");
export const myEmployee = (ctx: Ctx) => ctx.db.employee.findFirst({ where: { userId: ctx.user.id, deletedAt: null } });

export async function listTime(ctx: Ctx, p: { projectId?: string; employeeId?: string; from?: Date; to?: Date; skip: number; take: number }) {
  let employeeId = p.employeeId;
  if (!manageTime(ctx)) {
    const me = await myEmployee(ctx);
    if (!me) return { total: 0, rows: [], hours: d(0) };
    employeeId = me.id;
  }
  const where = { ...(p.projectId ? { projectId: p.projectId } : {}), ...(employeeId ? { employeeId } : {}), ...(p.from || p.to ? { date: { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lte: p.to } : {}) } } : {}) };
  const [total, rows, agg] = await Promise.all([
    ctx.db.timeEntry.count({ where }),
    ctx.db.timeEntry.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: p.skip, take: p.take, include: { project: { select: { id: true, code: true, name: true } }, task: { select: { id: true, title: true } }, employee: { select: { id: true, firstName: true, lastName: true } } } }),
    ctx.db.timeEntry.aggregate({ where, _sum: { hours: true } }),
  ]);
  return { total, rows, hours: d(agg._sum.hours ?? 0) };
}

export async function logTime(ctx: Ctx, input: z.output<typeof timeSchema>) {
  const emp = await ctx.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null } });
  if (!emp) throw notFound("Salarié");
  const own = emp.userId === ctx.user.id;
  if (!manageTime(ctx) && !(own && ctx.can("project.task.manage"))) throw forbidden("Vous ne pouvez saisir que votre propre temps.");
  if (emp.status !== "ACTIVE") throw businessRule("Seul un salarié en activité peut saisir du temps.");
  const pr = await getProject(ctx, input.projectId);
  if (pr.status !== "ACTIVE" && pr.status !== "PLANNED") throw businessRule("Ce projet n'accepte plus de saisie de temps (en pause, terminé ou annulé).");
  if (input.taskId && !(await ctx.db.projectTask.findFirst({ where: { id: input.taskId, projectId: pr.id }, select: { id: true } }))) throw notFound("Tâche");
  const date = day(parseDate(input.date)!);
  if (date > day(new Date())) throw businessRule("On ne saisit pas du temps à l'avance.");
  if (date < emp.hireDate) throw businessRule("Cette date précède l'embauche du salarié.");
  const costRate = d(emp.baseSalary).div(MONTHLY_HOURS).toDecimalPlaces(2);
  const e = await ctx.tx(async (tx) => {
    // total journalier plafonné à 24 h, vérifié sous verrou pour résister aux saisies simultanées
    await tx.$queryRaw`SELECT "id" FROM "Employee" WHERE "id" = ${emp.id}::uuid FOR UPDATE`;
    const agg = await tx.timeEntry.aggregate({ where: { employeeId: emp.id, date }, _sum: { hours: true } });
    if (d(agg._sum.hours ?? 0).plus(input.hours).gt(24)) throw businessRule("Plus de 24 h saisies pour ce salarié ce jour-là.");
    return tx.timeEntry.create({ data: { companyId: ctx.company.id, projectId: pr.id, taskId: input.taskId || null, employeeId: emp.id, date, hours: input.hours, billable: input.billable, costRate: costRate.toString(), billRate: input.billable ? pr.billRate : 0, description: blank(input.description), createdById: ctx.user.id } });
  });
  await audit(ctx, { action: "project.time.create", resource: "TimeEntry", resourceId: e.id, summary: `${ctx.user.name} a saisi ${input.hours} h pour ${emp.firstName} ${emp.lastName} sur ${pr.code} (${iso(date)}).` });
  return e;
}

async function editableEntry(ctx: Ctx, id: string) {
  const e = await ctx.db.timeEntry.findFirst({ where: { id }, include: { employee: { select: { userId: true } } } });
  if (!e) throw notFound("Saisie de temps");
  if (!manageTime(ctx) && e.employee.userId !== ctx.user.id) throw notFound("Saisie de temps");
  if (e.invoiceId) throw businessRule("Ce temps est déjà facturé : il ne peut plus être modifié ni supprimé.");
  return e;
}

export async function updateTime(ctx: Ctx, input: z.output<typeof updateTimeSchema>) {
  const e = await editableEntry(ctx, input.id);
  const date = day(parseDate(input.date)!);
  if (date > day(new Date())) throw businessRule("On ne saisit pas du temps à l'avance.");
  if (input.taskId && !(await ctx.db.projectTask.findFirst({ where: { id: input.taskId, projectId: e.projectId }, select: { id: true } }))) throw notFound("Tâche");
  const pr = await getProject(ctx, e.projectId);
  const after = await ctx.tx(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Employee" WHERE "id" = ${e.employeeId}::uuid FOR UPDATE`;
    const agg = await tx.timeEntry.aggregate({ where: { employeeId: e.employeeId, date, id: { not: e.id } }, _sum: { hours: true } });
    if (d(agg._sum.hours ?? 0).plus(input.hours).gt(24)) throw businessRule("Plus de 24 h saisies pour ce salarié ce jour-là.");
    return tx.timeEntry.update({ where: { id: e.id }, data: { taskId: input.taskId || null, date, hours: input.hours, billable: input.billable, billRate: input.billable ? pr.billRate : 0, description: blank(input.description) } });
  });
  await audit(ctx, { action: "project.time.update", resource: "TimeEntry", resourceId: e.id, summary: `${ctx.user.name} a modifié une saisie de temps (${input.hours} h, ${iso(date)}).` });
  return after;
}

export async function deleteTime(ctx: Ctx, id: string) {
  const e = await editableEntry(ctx, id);
  await ctx.db.timeEntry.delete({ where: { id } });
  await audit(ctx, { action: "project.time.delete", resource: "TimeEntry", resourceId: id, summary: `${ctx.user.name} a supprimé une saisie de ${d(e.hours).toNumber()} h.` });
}

/**
 * Facturation du temps : génère un BROUILLON de facture client (lignes par salarié et taux) à partir du temps facturable non encore facturé,
 * puis marque ces saisies comme facturées. Si le marquage échoue, le brouillon est supprimé (pas de facture orpheline).
 */
export async function invoiceTime(ctx: Ctx, input: z.output<typeof invoiceTimeSchema>) {
  if (!ctx.hasModule("sales")) throw forbidden("Le module Ventes est requis pour facturer le temps.");
  ctx.assertCan("finance.invoice.create");
  const pr = await getProject(ctx, input.projectId);
  if (!pr.customerId) throw businessRule("Rattachez un client au projet pour facturer son temps.");
  const entries = await ctx.db.timeEntry.findMany({
    where: { projectId: pr.id, billable: true, invoiceId: null, ...(input.entryIds?.length ? { id: { in: input.entryIds } } : {}) },
    include: { employee: { select: { firstName: true, lastName: true } } }, orderBy: { date: "asc" },
  });
  if (input.entryIds?.length && entries.length !== new Set(input.entryIds).size) throw businessRule("Certaines saisies sont introuvables, non facturables ou déjà facturées.");
  if (entries.length === 0) throw businessRule("Aucun temps facturable à facturer sur ce projet.");
  if (entries.some((e) => d(e.billRate).lte(0))) throw businessRule("Définissez un taux horaire de facturation sur le projet avant de facturer son temps.");
  const tax = await ctx.db.tax.findFirst({ where: { isDefault: true, isActive: true } });
  const groups = new Map<string, { label: string; hours: Decimal; rate: Decimal; from: Date; to: Date }>();
  for (const e of entries) {
    const key = `${e.employeeId}|${e.billRate.toString()}`;
    const g = groups.get(key);
    if (g) { g.hours = g.hours.plus(e.hours); g.to = e.date; }
    else groups.set(key, { label: `${e.employee.firstName} ${e.employee.lastName}`, hours: d(e.hours), rate: d(e.billRate), from: e.date, to: e.date });
  }
  const lines = [...groups.values()].map((g) => ({ description: `${pr.name} — ${g.label} (${iso(g.from)} → ${iso(g.to)})`, unit: "h", quantity: g.hours.toNumber(), unitPrice: g.rate.toNumber(), discountPct: 0, taxId: tax?.id ?? "" }));
  const invoice = await createInvoice(ctx, invoiceSchema.parse({ customerId: pr.customerId, issueDate: iso(new Date()), projectId: pr.id, notes: `Temps passé — projet ${pr.code}`, lines }));
  try {
    const r = await ctx.db.timeEntry.updateMany({ where: { id: { in: entries.map((e) => e.id) }, invoiceId: null }, data: { invoiceId: invoice.id } });
    if (r.count !== entries.length) throw businessRule("Du temps a été facturé entre-temps : recommencez.");
  } catch (e) {
    await ctx.db.invoice.delete({ where: { id: invoice.id } }).catch(() => undefined);
    throw e;
  }
  await audit(ctx, { action: "project.invoice_time", resource: "Project", resourceId: pr.id, summary: `${ctx.user.name} a généré un brouillon de facture de ${formatMoney(d(invoice.total).toNumber(), invoice.currency)} pour le temps du projet ${pr.code} (${entries.length} saisie(s)).` });
  return invoice;
}
