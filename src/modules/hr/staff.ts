import "server-only";
import type { z } from "zod";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { businessRule, notFound } from "@/core/errors";
import type { TenantContext } from "@/core/tenant/context";
import { assertOrgRefs } from "@/modules/org/service";
import type { assignmentSchema } from "./registers-schemas";
import { assertCan } from "./scope";
import { dayOf, parseDay } from "./time";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const fr = (v: Date) => v.toLocaleDateString("fr-FR", { timeZone: "UTC" });

export interface AssignmentState { jobTitle: string | null; departmentId: string | null; branchId: string | null; managerId: string | null }

/** Les champs d'affectation ont-ils changé ? (poste, service, agence, responsable) */
export const assignmentChanged = (a: AssignmentState, b: AssignmentState) =>
  (a.jobTitle ?? null) !== (b.jobTitle ?? null) || (a.departmentId ?? null) !== (b.departmentId ?? null) || (a.branchId ?? null) !== (b.branchId ?? null) || (a.managerId ?? null) !== (b.managerId ?? null);

/**
 * Enregistre une ligne d'historique d'affectation. Les NOMS du service, de l'agence et du responsable sont conservés tels qu'au moment du
 * changement : l'historique reste lisible même si le service est renommé ou le responsable parti. À appeler dans la transaction du changement.
 */
export async function recordAssignment(tx: Db, ctx: Pick<Ctx, "company" | "user">, employeeId: string, s: AssignmentState, effectiveDate: Date, reason: string | null) {
  const [dep, br, mgr] = await Promise.all([
    s.departmentId ? tx.department.findFirst({ where: { id: s.departmentId }, select: { name: true } }) : null,
    s.branchId ? tx.branch.findFirst({ where: { id: s.branchId }, select: { name: true } }) : null,
    s.managerId ? tx.employee.findFirst({ where: { id: s.managerId }, select: { firstName: true, lastName: true } }) : null,
  ]);
  return tx.employeeAssignment.create({
    data: {
      companyId: ctx.company.id, employeeId, effectiveDate, jobTitle: s.jobTitle, departmentId: s.departmentId, departmentName: dep?.name ?? null, branchId: s.branchId, branchName: br?.name ?? null,
      managerId: s.managerId, managerName: mgr ? `${mgr.lastName} ${mgr.firstName}` : null, reason, createdById: ctx.user.id,
    },
  });
}

export async function listAssignments(ctx: Ctx, employeeId: string) {
  assertCan(ctx, "hr.employee.read");
  if (!(await ctx.db.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: { id: true } }))) throw notFound("Salarié");
  return ctx.db.employeeAssignment.findMany({ where: { employeeId }, orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }] });
}

/**
 * Changement d'affectation daté : met à jour la fiche (poste, service, agence, responsable) ET garde la trace avec sa date d'effet et son motif.
 * La date ne peut ni précéder l'embauche ou la dernière affectation, ni être future (la fiche reflète la situation actuelle).
 */
export async function changeAssignment(ctx: Ctx, input: z.output<typeof assignmentSchema>) {
  assertCan(ctx, "hr.employee.update");
  const emp = await ctx.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null } });
  if (!emp) throw notFound("Salarié");
  if (emp.status === "TERMINATED") throw businessRule("Ce salarié est sorti des effectifs : son affectation n'est plus modifiable.");
  const date = parseDay(input.effectiveDate);
  if (!date) throw businessRule("Date d'effet invalide.");
  if (date > dayOf(new Date())) throw businessRule("La date d'effet ne peut pas être dans le futur.");
  if (date < emp.hireDate) throw businessRule("La date d'effet précède la date d'embauche.");
  const last = await ctx.db.employeeAssignment.findFirst({ where: { employeeId: emp.id }, orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }] });
  if (last && date < last.effectiveDate) throw businessRule(`La date d'effet précède la dernière affectation (${fr(last.effectiveDate)}).`);
  const next: AssignmentState = { jobTitle: blank(input.jobTitle), departmentId: input.departmentId || null, branchId: input.branchId || null, managerId: input.managerId || null };
  if (!assignmentChanged(emp, next)) throw businessRule("Aucun changement : poste, service, agence et responsable sont identiques.");
  await assertOrgRefs(ctx.db, { departmentId: next.departmentId, branchId: next.branchId });
  if (next.managerId) {
    if (next.managerId === emp.id) throw businessRule("Un salarié ne peut pas être son propre responsable.");
    if (!(await ctx.db.employee.findFirst({ where: { id: next.managerId, deletedAt: null, status: { not: "TERMINATED" } }, select: { id: true } }))) throw notFound("Responsable");
    let cur: string | null = next.managerId;
    for (let i = 0; cur && i < 50; i++) {
      if (cur === emp.id) throw businessRule("Ce responsable dépend déjà de ce salarié (boucle hiérarchique).");
      cur = (await ctx.db.employee.findFirst({ where: { id: cur }, select: { managerId: true } }))?.managerId ?? null;
    }
  }
  await ctx.tx(async (tx) => {
    await tx.employee.update({ where: { id: emp.id }, data: next });
    await recordAssignment(tx, ctx, emp.id, next, date, blank(input.reason));
  });
  await audit(ctx, { action: "hr.assignment.change", resource: "Employee", resourceId: emp.id, summary: `${ctx.user.name} a changé l'affectation de ${emp.firstName} ${emp.lastName} (${emp.number}) à compter du ${fr(date)}.`, before: { jobTitle: emp.jobTitle, departmentId: emp.departmentId, branchId: emp.branchId, managerId: emp.managerId }, after: next });
}

// ═══ Registre du personnel ════════════════════════════════════

export interface StaffFilters { q?: string; status?: string; departmentId?: string; skip: number; take: number }

/**
 * Registre du personnel : une ligne par salarié (actifs et sortis) avec les informations administratives de sa fiche et son dernier contrat.
 * Rien n'est dupliqué : tout est lu dans la fiche salarié et l'historique des contrats. Ni salaire ni pièce d'identité (voir la fiche).
 * Document de gestion interne : il ne remplace pas le registre légal de l'employeur.
 */
export async function staffRegister(ctx: Ctx, p: StaffFilters) {
  assertCan(ctx, "hr.employee.read");
  const where = {
    deletedAt: null,
    ...(p.status ? { status: p.status as never } : {}),
    ...(p.departmentId ? { departmentId: p.departmentId } : {}),
    ...(p.q ? { OR: ["firstName", "lastName", "number", "email", "jobTitle", "phone"].map((f) => ({ [f]: { contains: p.q, mode: "insensitive" as const } })) } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.employee.count({ where }),
    ctx.db.employee.findMany({
      where, orderBy: [{ number: "asc" }], skip: p.skip, take: p.take,
      select: {
        id: true, number: true, firstName: true, lastName: true, email: true, phone: true, birthDate: true, address: true, city: true, hireDate: true, endDate: true, terminationReason: true, status: true,
        jobTitle: true, professionalCategory: true, department: { select: { name: true } }, branch: { select: { name: true } }, manager: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);
  const contracts = await ctx.db.employmentContract.findMany({ where: { employeeId: { in: rows.map((r) => r.id) } }, orderBy: { startDate: "desc" }, select: { employeeId: true, type: true, startDate: true, endDate: true } });
  const latest = new Map<string, (typeof contracts)[number]>();
  for (const c of contracts) if (!latest.has(c.employeeId)) latest.set(c.employeeId, c);
  return { total, rows: rows.map((r) => ({ ...r, contract: latest.get(r.id) ?? null })) };
}
