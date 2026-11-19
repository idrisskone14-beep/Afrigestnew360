import "server-only";
import type { z } from "zod";
import { audit } from "@/core/audit";
import { businessRule, notFound } from "@/core/errors";
import type { TenantContext } from "@/core/tenant/context";
import { loadPolicy } from "./policy";
import type { completeVisitSchema, medicalVisitSchema, updateMedicalVisitSchema } from "./admin-schemas";
import { assertCan } from "./scope";
import { addDays, dayOf, parseDay } from "./time";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const fr = (v: Date) => v.toLocaleDateString("fr-FR", { timeZone: "UTC" });
const READ = "hr.medvisit.read", MANAGE = "hr.medvisit.manage";

/**
 * Visites médicales professionnelles : suivi ADMINISTRATIF (dates, organisme, échéance, réception du document d'aptitude). Aucun résultat
 * médical ni conclusion n'est enregistré ; le document d'aptitude se joint dans la GED, en accès restreint aux profils « visites médicales ».
 * Les périodicités réglementaires ne sont pas présumées : la prochaine échéance est saisie à la réalisation de la visite.
 */
export interface VisitLike { status: string; scheduledOn: Date | null }
export const visitState = (v: VisitLike, today: Date, reminderDays: number): "overdue" | "soon" | null => {
  if (v.status !== "PLANNED" || !v.scheduledOn) return null;
  const t = dayOf(today);
  if (v.scheduledOn < t) return "overdue";
  return v.scheduledOn <= addDays(t, reminderDays) ? "soon" : null;
};

export async function listVisits(ctx: Ctx, p: { status?: string; kind?: string; employeeId?: string; q?: string; skip: number; take: number }) {
  assertCan(ctx, READ);
  const where = {
    ...(p.status ? { status: p.status as never } : {}),
    ...(p.kind ? { kind: p.kind as never } : {}),
    ...(p.employeeId ? { employeeId: p.employeeId } : {}),
    ...(p.q ? { OR: [{ employee: { lastName: { contains: p.q, mode: "insensitive" as const } } }, { employee: { firstName: { contains: p.q, mode: "insensitive" as const } } }, { employee: { number: { contains: p.q, mode: "insensitive" as const } } }, { provider: { contains: p.q, mode: "insensitive" as const } }] } : {}),
  };
  const [total, rows, policy] = await Promise.all([
    ctx.db.medicalVisit.count({ where }),
    ctx.db.medicalVisit.findMany({ where, orderBy: [{ scheduledOn: "desc" }, { createdAt: "desc" }], skip: p.skip, take: p.take, include: { employee: { select: { id: true, firstName: true, lastName: true, number: true } } } }),
    loadPolicy(ctx.db),
  ]);
  const today = new Date();
  return { total, rows: rows.map((r) => ({ ...r, state: visitState(r, today, policy.visitReminderDays) })) };
}

/**
 * Rappels : visites programmées en retard ou proches, et salariés dont la prochaine échéance (saisie à la dernière visite réalisée) approche
 * sans visite programmée → « à programmer ».
 */
export async function visitAlerts(ctx: Ctx, today = new Date()) {
  assertCan(ctx, READ);
  const policy = await loadPolicy(ctx.db);
  const t = dayOf(today), horizon = addDays(t, policy.visitReminderDays);
  const emp = { select: { id: true, firstName: true, lastName: true, number: true } };
  const [planned, due] = await Promise.all([
    ctx.db.medicalVisit.findMany({ where: { status: "PLANNED", scheduledOn: { lte: horizon }, employee: { status: "ACTIVE", deletedAt: null } }, include: { employee: emp }, orderBy: { scheduledOn: "asc" } }),
    ctx.db.medicalVisit.findMany({ where: { status: "DONE", nextDueOn: { lte: horizon }, employee: { status: "ACTIVE", deletedAt: null } }, include: { employee: emp }, orderBy: { nextDueOn: "asc" } }),
  ]);
  // une échéance n'est à programmer que si c'est la plus récente du salarié et qu'aucune visite n'est déjà programmée
  const hasPlanned = new Set((await ctx.db.medicalVisit.findMany({ where: { status: "PLANNED", employeeId: { in: due.map((d) => d.employeeId) } }, select: { employeeId: true } })).map((p) => p.employeeId));
  const latest = new Map<string, (typeof due)[number]>();
  for (const v of (await ctx.db.medicalVisit.findMany({ where: { status: "DONE", doneOn: { not: null }, employeeId: { in: due.map((d) => d.employeeId) } }, orderBy: { doneOn: "desc" }, include: { employee: emp } }))) if (!latest.has(v.employeeId)) latest.set(v.employeeId, v);
  const toSchedule = [...latest.values()].filter((v) => v.nextDueOn && v.nextDueOn <= horizon && !hasPlanned.has(v.employeeId));
  return {
    overdue: planned.filter((v) => v.scheduledOn! < t),
    soon: planned.filter((v) => v.scheduledOn! >= t),
    toSchedule,
  };
}

export async function createVisit(ctx: Ctx, input: z.output<typeof medicalVisitSchema>) {
  assertCan(ctx, MANAGE);
  const emp = await ctx.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null } });
  if (!emp) throw notFound("Salarié");
  if (emp.status === "TERMINATED") throw businessRule("Ce salarié est sorti des effectifs.");
  const date = parseDay(input.scheduledOn);
  if (!date) throw businessRule("Date invalide.");
  if (await ctx.db.medicalVisit.findFirst({ where: { employeeId: emp.id, kind: input.kind, status: "PLANNED", scheduledOn: date }, select: { id: true } })) throw businessRule("Une visite du même type est déjà programmée ce jour-là pour ce salarié.");
  const v = await ctx.db.medicalVisit.create({ data: { companyId: ctx.company.id, employeeId: emp.id, kind: input.kind, scheduledOn: date, provider: blank(input.provider), notes: blank(input.notes), createdById: ctx.user.id } });
  await audit(ctx, { action: "hr.medvisit.create", resource: "MedicalVisit", resourceId: v.id, summary: `${ctx.user.name} a programmé une visite médicale (${input.kind}) pour ${emp.firstName} ${emp.lastName} le ${fr(date)}.` });
  return v;
}

async function loadPlanned(ctx: Ctx, id: string) {
  assertCan(ctx, MANAGE);
  const v = await ctx.db.medicalVisit.findFirst({ where: { id }, include: { employee: { select: { firstName: true, lastName: true, hireDate: true } } } });
  if (!v) throw notFound("Visite médicale");
  if (v.status !== "PLANNED") throw businessRule(v.status === "DONE" ? "Cette visite est réalisée." : "Cette visite est annulée.");
  return v;
}

export async function updateVisit(ctx: Ctx, input: z.output<typeof updateMedicalVisitSchema>) {
  const v = await loadPlanned(ctx, input.id);
  const date = parseDay(input.scheduledOn);
  if (!date) throw businessRule("Date invalide.");
  const after = await ctx.db.medicalVisit.update({ where: { id: v.id }, data: { kind: input.kind, scheduledOn: date, provider: blank(input.provider), notes: blank(input.notes) } });
  await audit(ctx, { action: "hr.medvisit.update", resource: "MedicalVisit", resourceId: v.id, summary: `${ctx.user.name} a modifié la visite médicale de ${v.employee.firstName} ${v.employee.lastName}.`, before: { scheduledOn: v.scheduledOn }, after: { scheduledOn: after.scheduledOn } });
  return after;
}

/** Réalisation : date, prochaine échéance (saisie par l'entreprise), statut du document d'aptitude. */
export async function completeVisit(ctx: Ctx, input: z.output<typeof completeVisitSchema>) {
  const v = await loadPlanned(ctx, input.id);
  const done = parseDay(input.doneOn);
  if (!done) throw businessRule("Date de réalisation invalide.");
  if (done > dayOf(new Date())) throw businessRule("La date de réalisation ne peut pas être dans le futur.");
  if (done < v.employee.hireDate) throw businessRule("La visite précède l'embauche.");
  const next = input.nextDueOn ? parseDay(input.nextDueOn) : null;
  if (input.nextDueOn && !next) throw businessRule("Date d'échéance invalide.");
  if (next && next <= done) throw businessRule("La prochaine échéance doit suivre la date de réalisation.");
  await ctx.db.medicalVisit.update({ where: { id: v.id }, data: { status: "DONE", doneOn: done, nextDueOn: next, aptitudeDoc: input.aptitudeDoc } });
  await audit(ctx, { action: "hr.medvisit.complete", resource: "MedicalVisit", resourceId: v.id, summary: `${ctx.user.name} a enregistré la visite médicale de ${v.employee.firstName} ${v.employee.lastName} réalisée le ${fr(done)}${next ? ` (prochaine échéance : ${fr(next)})` : ""}.` });
}

export async function cancelVisit(ctx: Ctx, id: string) {
  const v = await loadPlanned(ctx, id);
  await ctx.db.medicalVisit.update({ where: { id }, data: { status: "CANCELLED" } });
  await audit(ctx, { action: "hr.medvisit.cancel", resource: "MedicalVisit", resourceId: id, summary: `${ctx.user.name} a annulé la visite médicale de ${v.employee.firstName} ${v.employee.lastName}.` });
}

/** Réception (ou non) du document d'aptitude d'une visite réalisée. */
export async function setAptitudeDoc(ctx: Ctx, input: { id: string; aptitudeDoc: "NOT_REQUIRED" | "PENDING" | "PROVIDED" }) {
  assertCan(ctx, MANAGE);
  const v = await ctx.db.medicalVisit.findFirst({ where: { id: input.id } });
  if (!v) throw notFound("Visite médicale");
  if (v.status !== "DONE") throw businessRule("Seule une visite réalisée porte un document d'aptitude.");
  await ctx.db.medicalVisit.update({ where: { id: v.id }, data: { aptitudeDoc: input.aptitudeDoc } });
  await audit(ctx, { action: "hr.medvisit.aptitude", resource: "MedicalVisit", resourceId: v.id, summary: `${ctx.user.name} a passé le document d'aptitude à « ${input.aptitudeDoc} ».`, before: { aptitudeDoc: v.aptitudeDoc }, after: { aptitudeDoc: input.aptitudeDoc } });
}
