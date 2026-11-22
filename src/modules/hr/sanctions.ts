import "server-only";
import type { z } from "zod";
import { audit } from "@/core/audit";
import { businessRule, notFound } from "@/core/errors";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import type { closeCaseSchema, decideCaseSchema, disciplinaryCaseSchema, notifyCaseSchema, sanctionTypeSchema, stepSchema, updateDisciplinaryCaseSchema, updateSanctionTypeSchema } from "./admin-schemas";
import { assertCan } from "./scope";
import { dayOf, parseDay } from "./time";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const fr = (v: Date) => v.toLocaleDateString("fr-FR", { timeZone: "UTC" });
const READ = "hr.sanction.read", MANAGE = "hr.sanction.manage";

/**
 * Dossiers disciplinaires : registre de SUIVI de procédure. Le logiciel ne prononce, ne propose et ne génère JAMAIS une sanction : aucun retard,
 * aucune absence ne crée de dossier. Les types de sanction et l'exigence d'une audition préalable sont réglés par l'entreprise, selon son règlement
 * intérieur et la procédure légale applicable (à valider par son conseil). Accès réservé aux profils « sanctions » ; aucune suppression.
 */

export const listSanctionTypes = (ctx: Ctx, includeInactive = false) => ctx.db.sanctionType.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { name: "asc" } });

export async function createSanctionType(ctx: Ctx, input: z.output<typeof sanctionTypeSchema>) {
  assertCan(ctx, MANAGE);
  if (await ctx.db.sanctionType.findFirst({ where: { name: { equals: input.name.trim(), mode: "insensitive" } } })) throw businessRule("Ce type de sanction existe déjà.");
  const t = await ctx.db.sanctionType.create({ data: { companyId: ctx.company.id, name: input.name.trim(), requiresHearing: input.requiresHearing, description: blank(input.description) } });
  await audit(ctx, { action: "hr.sanction_type.create", resource: "SanctionType", resourceId: t.id, summary: `${ctx.user.name} a créé le type de sanction « ${t.name} ».` });
  return t;
}

export async function updateSanctionType(ctx: Ctx, input: z.output<typeof updateSanctionTypeSchema>) {
  assertCan(ctx, MANAGE);
  const t = await ctx.db.sanctionType.findFirst({ where: { id: input.id } });
  if (!t) throw notFound("Type de sanction");
  if (await ctx.db.sanctionType.findFirst({ where: { name: { equals: input.name.trim(), mode: "insensitive" }, id: { not: input.id } } })) throw businessRule("Ce type de sanction existe déjà.");
  const after = await ctx.db.sanctionType.update({ where: { id: input.id }, data: { name: input.name.trim(), requiresHearing: input.requiresHearing, description: blank(input.description), isActive: input.isActive } });
  await audit(ctx, { action: "hr.sanction_type.update", resource: "SanctionType", resourceId: t.id, summary: `${ctx.user.name} a modifié le type de sanction « ${after.name} ».`, before: { requiresHearing: t.requiresHearing, isActive: t.isActive }, after: { requiresHearing: after.requiresHearing, isActive: after.isActive } });
  return after;
}

export async function listCases(ctx: Ctx, p: { status?: string; employeeId?: string; q?: string; skip: number; take: number }) {
  assertCan(ctx, READ);
  const where = {
    ...(p.status ? { status: p.status as never } : {}),
    ...(p.employeeId ? { employeeId: p.employeeId } : {}),
    ...(p.q ? { OR: ["number", "employeeName", "employeeNumber", "breachNature"].map((f) => ({ [f]: { contains: p.q, mode: "insensitive" as const } })) } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.disciplinaryCase.count({ where }),
    ctx.db.disciplinaryCase.findMany({ where, orderBy: [{ factsDate: "desc" }, { number: "desc" }], skip: p.skip, take: p.take, include: { sanctionType: { select: { name: true } }, _count: { select: { steps: true } } } }),
  ]);
  return { total, rows };
}

export async function getCase(ctx: Ctx, id: string) {
  assertCan(ctx, READ);
  const c = await ctx.db.disciplinaryCase.findFirst({ where: { id }, include: { sanctionType: true, steps: { orderBy: [{ date: "asc" }, { createdAt: "asc" }] } } });
  if (!c) throw notFound("Dossier disciplinaire");
  const [history, documentCount] = await Promise.all([
    ctx.db.auditLog.findMany({ where: { resource: "DisciplinaryCase", resourceId: id }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, summary: true, createdAt: true } }),
    ctx.db.documentLink.count({ where: { entityType: "hr_sanction", entityId: id } }),
  ]);
  return { ...c, history, documentCount };
}

/** Consultation d'un dossier sensible : tracée. */
export async function logCaseView(ctx: Ctx, c: { id: string; number: string }) {
  await audit(ctx, { action: "hr.sanction.view", resource: "DisciplinaryCase", resourceId: c.id, summary: `${ctx.user.name} a consulté le dossier disciplinaire ${c.number}.` });
}

export async function createCase(ctx: Ctx, input: z.output<typeof disciplinaryCaseSchema>) {
  assertCan(ctx, MANAGE);
  const emp = await ctx.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null } });
  if (!emp) throw notFound("Salarié");
  const facts = parseDay(input.factsDate);
  if (!facts) throw businessRule("Date des faits invalide.");
  if (facts > dayOf(new Date())) throw businessRule("La date des faits ne peut pas être dans le futur.");
  if (facts < emp.hireDate) throw businessRule("Les faits précèdent l'embauche du salarié.");
  return ctx.tx(async (tx) => {
    const number = await nextNumber(tx, ctx.company.id, "disciplinary");
    const c = await tx.disciplinaryCase.create({
      data: { companyId: ctx.company.id, number, employeeId: emp.id, employeeNumber: emp.number, employeeName: `${emp.lastName} ${emp.firstName}`, factsDate: facts, description: input.description.trim(), breachNature: input.breachNature.trim(), procedureNote: blank(input.procedureNote), responsibleName: blank(input.responsibleName) ?? ctx.user.name, observations: blank(input.observations), createdById: ctx.user.id },
    });
    await audit(ctx, { action: "hr.sanction.create", resource: "DisciplinaryCase", resourceId: c.id, summary: `${ctx.user.name} a ouvert le dossier disciplinaire ${c.number} (${c.employeeName}, faits du ${fr(facts)}).` }, tx);
    return c;
  });
}

async function loadOpen(ctx: Ctx, id: string, allowDecided = false) {
  assertCan(ctx, MANAGE);
  const c = await ctx.db.disciplinaryCase.findFirst({ where: { id }, include: { steps: true, sanctionType: true } });
  if (!c) throw notFound("Dossier disciplinaire");
  const ok = c.status === "OPEN" || (allowDecided && c.status === "DECIDED");
  if (!ok) throw businessRule(c.status === "NOTIFIED" ? "La sanction est notifiée : le dossier n'est plus modifiable." : c.status === "CLOSED" ? "Ce dossier est classé sans suite." : c.status === "DECIDED" ? "La sanction est décidée : seule sa notification reste possible." : "Ce dossier est annulé.");
  return c;
}

export async function updateCase(ctx: Ctx, input: z.output<typeof updateDisciplinaryCaseSchema>) {
  const c = await loadOpen(ctx, input.id);
  const facts = parseDay(input.factsDate);
  if (!facts) throw businessRule("Date des faits invalide.");
  if (facts > dayOf(new Date())) throw businessRule("La date des faits ne peut pas être dans le futur.");
  if (c.steps.some((s) => s.date < facts)) throw businessRule("Une étape de la procédure précède la nouvelle date des faits.");
  const after = await ctx.db.disciplinaryCase.update({ where: { id: c.id }, data: { factsDate: facts, description: input.description.trim(), breachNature: input.breachNature.trim(), procedureNote: blank(input.procedureNote), responsibleName: blank(input.responsibleName), observations: blank(input.observations) } });
  await audit(ctx, { action: "hr.sanction.update", resource: "DisciplinaryCase", resourceId: c.id, summary: `${ctx.user.name} a modifié le dossier disciplinaire ${c.number}.`, before: { factsDate: c.factsDate, breachNature: c.breachNature }, after: { factsDate: after.factsDate, breachNature: after.breachNature } });
  return after;
}

/** Étape de procédure (convocation, audition, explications…). « Décision » et « Notification » passent par leurs actions dédiées. */
export async function addStep(ctx: Ctx, input: z.output<typeof stepSchema>) {
  const c = await loadOpen(ctx, input.caseId);
  if (input.kind === "DECISION" || input.kind === "NOTIFICATION") throw businessRule("La décision et la notification s'enregistrent avec leurs actions dédiées.");
  const date = parseDay(input.date);
  if (!date) throw businessRule("Date invalide.");
  if (date > dayOf(new Date())) throw businessRule("Une étape ne peut pas être datée dans le futur.");
  if (date < c.factsDate) throw businessRule("L'étape précède la date des faits.");
  const s = await ctx.db.disciplinaryStep.create({ data: { companyId: ctx.company.id, caseId: c.id, kind: input.kind, date, note: blank(input.note), createdById: ctx.user.id } });
  await audit(ctx, { action: "hr.sanction.step", resource: "DisciplinaryCase", resourceId: c.id, summary: `${ctx.user.name} a ajouté une étape « ${input.kind} » (${fr(date)}) au dossier ${c.number}.` });
  return s;
}

/**
 * Décision : le type de sanction est choisi par la personne habilitée parmi ceux de l'entreprise. Si ce type exige une audition, au moins une
 * étape « audition » doit exister à la date de la décision ou avant (règle réglée par l'entreprise, non présumée par le logiciel).
 */
export async function decideCase(ctx: Ctx, input: z.output<typeof decideCaseSchema>) {
  const c = await loadOpen(ctx, input.id);
  const type = await ctx.db.sanctionType.findFirst({ where: { id: input.sanctionTypeId, isActive: true } });
  if (!type) throw notFound("Type de sanction");
  const date = parseDay(input.decisionDate);
  if (!date) throw businessRule("Date de décision invalide.");
  if (date > dayOf(new Date())) throw businessRule("La date de décision ne peut pas être dans le futur.");
  if (date < c.factsDate) throw businessRule("La décision précède la date des faits.");
  if (type.requiresHearing && !c.steps.some((s) => s.kind === "HEARING" && s.date <= date)) throw businessRule(`« ${type.name} » exige une audition préalable : enregistrez l'étape « Audition / entretien » avant la décision.`);
  await ctx.tx(async (tx) => {
    await tx.disciplinaryCase.update({ where: { id: c.id }, data: { sanctionTypeId: type.id, decisionDate: date, status: "DECIDED" } });
    await tx.disciplinaryStep.create({ data: { companyId: ctx.company.id, caseId: c.id, kind: "DECISION", date, note: blank(input.note) ?? type.name, createdById: ctx.user.id } });
  });
  await audit(ctx, { action: "hr.sanction.decide", resource: "DisciplinaryCase", resourceId: c.id, summary: `${ctx.user.name} a enregistré la décision « ${type.name} » (${fr(date)}) au dossier ${c.number}.` });
}

export async function notifyCase(ctx: Ctx, input: z.output<typeof notifyCaseSchema>) {
  assertCan(ctx, MANAGE);
  const c = await ctx.db.disciplinaryCase.findFirst({ where: { id: input.id } });
  if (!c) throw notFound("Dossier disciplinaire");
  if (c.status !== "DECIDED") throw businessRule("Seule une sanction décidée peut être notifiée.");
  const date = parseDay(input.notificationDate);
  if (!date) throw businessRule("Date invalide.");
  if (date > dayOf(new Date())) throw businessRule("La notification ne peut pas être datée dans le futur.");
  if (date < c.decisionDate!) throw businessRule("La notification précède la décision.");
  await ctx.tx(async (tx) => {
    await tx.disciplinaryCase.update({ where: { id: c.id }, data: { notificationDate: date, status: "NOTIFIED" } });
    await tx.disciplinaryStep.create({ data: { companyId: ctx.company.id, caseId: c.id, kind: "NOTIFICATION", date, createdById: ctx.user.id } });
  });
  await audit(ctx, { action: "hr.sanction.notify", resource: "DisciplinaryCase", resourceId: c.id, summary: `${ctx.user.name} a enregistré la notification de la sanction (${fr(date)}) au dossier ${c.number}.` });
}

/** Classement sans suite (motif obligatoire) : la procédure s'arrête, le dossier reste conservé. */
export async function closeCase(ctx: Ctx, input: z.output<typeof closeCaseSchema>) {
  const c = await loadOpen(ctx, input.id);
  if (!blank(input.note)) throw businessRule("Indiquez le motif du classement sans suite.");
  await ctx.db.disciplinaryCase.update({ where: { id: c.id }, data: { status: "CLOSED", observations: [c.observations, `Classé sans suite : ${input.note!.trim()}`].filter(Boolean).join("\n") } });
  await audit(ctx, { action: "hr.sanction.close", resource: "DisciplinaryCase", resourceId: c.id, summary: `${ctx.user.name} a classé sans suite le dossier disciplinaire ${c.number}.` });
}

/** Annulation d'un dossier ouvert ou décidé non notifié (erreur de saisie) : motif obligatoire, dossier conservé. */
export async function cancelCase(ctx: Ctx, input: z.output<typeof closeCaseSchema>) {
  const c = await loadOpen(ctx, input.id, true);
  if (!blank(input.note)) throw businessRule("Indiquez le motif de l'annulation.");
  await ctx.db.disciplinaryCase.update({ where: { id: c.id }, data: { status: "CANCELLED", observations: [c.observations, `Annulé : ${input.note!.trim()}`].filter(Boolean).join("\n") } });
  await audit(ctx, { action: "hr.sanction.cancel", resource: "DisciplinaryCase", resourceId: c.id, summary: `${ctx.user.name} a annulé le dossier disciplinaire ${c.number}.` });
}
