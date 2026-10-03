import "server-only";
import { audit } from "@/core/audit";
import { cancelApprovals } from "@/core/approvals";
import { parseDate } from "@/core/documents/lines";
import { businessRule, forbidden, notFound } from "@/core/errors";
import { d, roundMoney } from "@/core/money";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import { formatMoney } from "@/lib/reference-data";
import { assertOrgRefs } from "@/modules/org/service";
import type { z } from "zod";
import type { contractSchema, employeeSchema, terminateSchema, updateEmployeeSchema } from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const DAY = 86_400_000;
const day = (v: Date) => new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
const iso = (v: Date) => v.toISOString().slice(0, 10);

/** Rémunération, pièce d'identité et coordonnées de paiement : réservées aux droits « contrats » et « paie ». */
export const canSeePay = (ctx: Pick<Ctx, "can">) => ctx.can("hr.contract.manage") || ctx.can("hr.payroll.manage");

/** Salarié lié au compte utilisateur courant (libre-service : congés, bulletins). */
export const employeeOfUser = (ctx: Ctx) => ctx.db.employee.findFirst({ where: { userId: ctx.user.id, deletedAt: null } });

export async function listEmployees(ctx: Ctx, p: { q?: string; status?: string; departmentId?: string; branchId?: string; skip: number; take: number }) {
  const where = {
    deletedAt: null,
    ...(p.status ? { status: p.status as never } : {}),
    ...(p.departmentId ? { departmentId: p.departmentId } : {}),
    ...(p.branchId ? { branchId: p.branchId } : {}),
    ...(p.q ? { OR: ["firstName", "lastName", "number", "email", "jobTitle"].map((f) => ({ [f]: { contains: p.q, mode: "insensitive" as const } })) } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.employee.count({ where }),
    ctx.db.employee.findMany({ where, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], skip: p.skip, take: p.take, include: { department: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } } } }),
  ]);
  const pay = canSeePay(ctx);
  return { total, rows: rows.map((e) => ({ ...e, baseSalary: pay ? e.baseSalary : null, nationalId: pay ? e.nationalId : null, payoutReference: pay ? e.payoutReference : null })) };
}

export async function getEmployee(ctx: Ctx, id: string) {
  const e = await ctx.db.employee.findFirst({
    where: { id, deletedAt: null },
    include: { department: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } }, manager: { select: { id: true, firstName: true, lastName: true } } },
  });
  if (!e) throw notFound("Salarié");
  const pay = canSeePay(ctx);
  return { ...e, baseSalary: pay ? e.baseSalary : null, nationalId: pay ? e.nationalId : null, payoutReference: pay ? e.payoutReference : null };
}

async function checkRefs(ctx: Ctx, input: { departmentId?: string | null; branchId?: string | null; managerId?: string | null; userId?: string | null }, selfId?: string) {
  await assertOrgRefs(ctx.db, { departmentId: input.departmentId, branchId: input.branchId });
  if (input.managerId) {
    if (input.managerId === selfId) throw businessRule("Un salarié ne peut pas être son propre responsable.");
    if (!(await ctx.db.employee.findFirst({ where: { id: input.managerId, deletedAt: null, status: { not: "TERMINATED" } }, select: { id: true } }))) throw notFound("Responsable");
    // pas de boucle hiérarchique : le responsable ne doit pas dépendre (même indirectement) du salarié
    let cur: string | null = input.managerId;
    for (let i = 0; selfId && cur && i < 50; i++) {
      if (cur === selfId) throw businessRule("Ce responsable dépend déjà de ce salarié (boucle hiérarchique).");
      cur = (await ctx.db.employee.findFirst({ where: { id: cur }, select: { managerId: true } }))?.managerId ?? null;
    }
  }
  if (input.userId) {
    if (!(await ctx.db.companyMembership.findFirst({ where: { userId: input.userId, status: "ACTIVE" }, select: { id: true } }))) throw notFound("Utilisateur");
    const taken = await ctx.db.employee.findFirst({ where: { userId: input.userId, deletedAt: null, ...(selfId ? { id: { not: selfId } } : {}) }, select: { number: true } });
    if (taken) throw businessRule(`Cet utilisateur est déjà lié au salarié ${taken.number}.`);
  }
}

function assertPayRight(ctx: Ctx, salary: number) {
  if (salary > 0 && !canSeePay(ctx)) throw forbidden("Seuls les profils habilités (contrats, paie) peuvent définir une rémunération.");
}

export async function createEmployee(ctx: Ctx, input: z.output<typeof employeeSchema>) {
  assertPayRight(ctx, input.baseSalary);
  await checkRefs(ctx, input);
  const hire = parseDate(input.hireDate) ?? new Date();
  const e = await ctx.tx(async (tx) => {
    const number = await nextNumber(tx, ctx.company.id, "employee"); // le matricule ne dépend pas de la date d'embauche
    return tx.employee.create({
      data: {
        companyId: ctx.company.id, number, firstName: input.firstName.trim(), lastName: input.lastName.trim(), email: blank(input.email), phone: blank(input.phone), birthDate: parseDate(input.birthDate), nationalId: canSeePay(ctx) ? blank(input.nationalId) : null,
        address: blank(input.address), city: blank(input.city), hireDate: day(hire), jobTitle: blank(input.jobTitle), departmentId: input.departmentId || null, branchId: input.branchId || null, managerId: input.managerId || null, userId: input.userId || null,
        baseSalary: roundMoney(input.baseSalary, ctx.company.currency).toString(), currency: ctx.company.currency, payoutMethod: input.payoutMethod, payoutReference: canSeePay(ctx) ? blank(input.payoutReference) : null, createdById: ctx.user.id,
      },
    });
  });
  await audit(ctx, { action: "hr.employee.create", resource: "Employee", resourceId: e.id, summary: `${ctx.user.name} a enregistré le salarié ${e.number} — ${e.firstName} ${e.lastName}.` });
  return e;
}

export async function updateEmployee(ctx: Ctx, input: z.output<typeof updateEmployeeSchema>) {
  const before = await ctx.db.employee.findFirst({ where: { id: input.id, deletedAt: null } });
  if (!before) throw notFound("Salarié");
  if (before.status === "TERMINATED") throw businessRule("Ce salarié est sorti des effectifs : sa fiche n'est plus modifiable.");
  await checkRefs(ctx, input, input.id);
  const pay = canSeePay(ctx);
  const salary = pay ? roundMoney(input.baseSalary, ctx.company.currency) : d(before.baseSalary);
  const after = await ctx.db.employee.update({
    where: { id: input.id },
    data: {
      firstName: input.firstName.trim(), lastName: input.lastName.trim(), email: blank(input.email), phone: blank(input.phone), birthDate: parseDate(input.birthDate), address: blank(input.address), city: blank(input.city),
      hireDate: day(parseDate(input.hireDate) ?? before.hireDate), jobTitle: blank(input.jobTitle), departmentId: input.departmentId || null, branchId: input.branchId || null, managerId: input.managerId || null, userId: input.userId || null,
      payoutMethod: input.payoutMethod,
      ...(pay ? { baseSalary: salary.toString(), nationalId: blank(input.nationalId), payoutReference: blank(input.payoutReference) } : {}),
    },
  });
  const salaryNote = pay && !salary.eq(before.baseSalary) ? ` Salaire de base : ${formatMoney(d(before.baseSalary).toNumber(), after.currency)} → ${formatMoney(salary.toNumber(), after.currency)}.` : "";
  await audit(ctx, { action: "hr.employee.update", resource: "Employee", resourceId: after.id, summary: `${ctx.user.name} a modifié la fiche de ${after.firstName} ${after.lastName} (${after.number}).${salaryNote}` });
  return after;
}

/** Sortie des effectifs : clôture les contrats en cours et annule les demandes de congé en attente. */
export async function terminateEmployee(ctx: Ctx, input: z.output<typeof terminateSchema>) {
  const e = await ctx.db.employee.findFirst({ where: { id: input.id, deletedAt: null } });
  if (!e) throw notFound("Salarié");
  if (e.status === "TERMINATED") throw businessRule("Ce salarié est déjà sorti des effectifs.");
  const end = day(parseDate(input.endDate) ?? new Date());
  if (end < e.hireDate) throw businessRule("La date de sortie précède la date d'embauche.");
  await ctx.tx(async (tx) => {
    await tx.employee.update({ where: { id: e.id }, data: { status: "TERMINATED", endDate: end, terminationReason: blank(input.reason) } });
    await tx.employmentContract.updateMany({ where: { employeeId: e.id, OR: [{ endDate: null }, { endDate: { gt: end } }] }, data: { endDate: end } });
    const pending = await tx.leaveRequest.findMany({ where: { employeeId: e.id, status: "PENDING" }, select: { id: true } });
    for (const l of pending) { await cancelApprovals(tx, "leave", l.id); }
    await tx.leaveRequest.updateMany({ where: { employeeId: e.id, status: "PENDING" }, data: { status: "CANCELLED" } });
  });
  await audit(ctx, { action: "hr.employee.terminate", resource: "Employee", resourceId: e.id, summary: `${ctx.user.name} a enregistré la sortie de ${e.firstName} ${e.lastName} (${e.number}) au ${iso(end)}.`, after: { reason: input.reason ?? null } });
}

// ═══ Contrats ═════════════════════════════════════════════════

export async function listContracts(ctx: Ctx, employeeId: string) {
  if (!canSeePay(ctx)) throw forbidden();
  return ctx.db.employmentContract.findMany({ where: { employeeId }, orderBy: { startDate: "desc" } });
}

/**
 * Nouveau contrat : clôture la veille le contrat en cours, met à jour le salaire de base et le poste du salarié
 * (c'est le salaire de base qui alimente la paie).
 */
export async function addContract(ctx: Ctx, input: z.output<typeof contractSchema>) {
  const emp = await ctx.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null } });
  if (!emp) throw notFound("Salarié");
  if (emp.status === "TERMINATED") throw businessRule("Ce salarié est sorti des effectifs.");
  const start = day(parseDate(input.startDate) ?? new Date());
  const end = parseDate(input.endDate) ? day(parseDate(input.endDate)!) : null;
  if (end && end < start) throw businessRule("La fin du contrat précède son début.");
  if (input.type === "FIXED_TERM" && !end) throw businessRule("Un CDD doit avoir une date de fin.");
  const salary = roundMoney(input.salary, ctx.company.currency);
  const c = await ctx.tx(async (tx) => {
    const open = await tx.employmentContract.findMany({ where: { employeeId: emp.id, startDate: { lt: start }, OR: [{ endDate: null }, { endDate: { gte: start } }] } });
    for (const o of open) await tx.employmentContract.update({ where: { id: o.id }, data: { endDate: new Date(start.getTime() - DAY) } });
    if (await tx.employmentContract.findFirst({ where: { employeeId: emp.id, startDate: { gte: start } } })) throw businessRule("Un contrat existe déjà à partir de cette date ou après : le nouveau contrat doit être le plus récent.");
    const created = await tx.employmentContract.create({ data: { companyId: ctx.company.id, employeeId: emp.id, type: input.type, startDate: start, endDate: end, jobTitle: blank(input.jobTitle), salary: salary.toString(), notes: blank(input.notes), createdById: ctx.user.id } });
    await tx.employee.update({ where: { id: emp.id }, data: { baseSalary: salary.toString(), ...(blank(input.jobTitle) ? { jobTitle: blank(input.jobTitle) } : {}) } });
    return created;
  });
  await audit(ctx, { action: "hr.contract.create", resource: "EmploymentContract", resourceId: c.id, summary: `${ctx.user.name} a enregistré un contrat (${input.type}) pour ${emp.firstName} ${emp.lastName} dès le ${iso(start)}. Salaire de base : ${formatMoney(d(emp.baseSalary).toNumber(), emp.currency)} → ${formatMoney(salary.toNumber(), emp.currency)}.` });
  return c;
}

/** Contrats à durée déterminée arrivant à échéance dans les `days` jours (salariés en poste). */
export async function endingContracts(ctx: Pick<Ctx, "db">, days = 30) {
  const today = day(new Date());
  return ctx.db.employmentContract.findMany({
    where: { endDate: { gte: today, lte: new Date(today.getTime() + days * DAY) }, employee: { status: { not: "TERMINATED" }, deletedAt: null } },
    orderBy: { endDate: "asc" },
    include: { employee: { select: { id: true, firstName: true, lastName: true, number: true } } },
  });
}
