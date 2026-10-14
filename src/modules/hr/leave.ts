import "server-only";
import { audit } from "@/core/audit";
import { availableApprovers, cancelApprovals, requestApproval } from "@/core/approvals";
import type { Db } from "@/core/db/client";
import { parseDate } from "@/core/documents/lines";
import { businessRule, forbidden, notFound } from "@/core/errors";
import { d } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import "@/modules/registry";
import type { z } from "zod";
import { loadCalendar } from "./calendar";
import { employeeOfUser } from "./employees";
import { computeBalance, workingDays, type LeaveRow, type LeaveRule } from "./leave-calc";
import type { leaveRequestSchema, leaveTypeSchema, updateLeaveTypeSchema } from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const day = (v: Date) => new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
const iso = (v: Date) => v.toISOString().slice(0, 10);
const fr = (v: Date) => v.toLocaleDateString("fr-FR", { timeZone: "UTC" });

export { workingDays };

// ═══ Types de congé ═══════════════════════════════════════════

const ruleOf = (t: { annualDays: unknown; accrual: "UPFRONT" | "MONTHLY"; carryOverMax: unknown; carryOverExpiryMonth: number | null }): LeaveRule => ({ annualDays: Number(t.annualDays), accrual: t.accrual, carryOverMax: Number(t.carryOverMax), carryOverExpiryMonth: t.carryOverExpiryMonth });

export const listLeaveTypes = (ctx: Ctx, includeInactive = false) => ctx.db.leaveType.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { name: "asc" } });

export async function createLeaveType(ctx: Ctx, input: z.output<typeof leaveTypeSchema>) {
  if (await ctx.db.leaveType.findFirst({ where: { name: input.name.trim() } })) throw businessRule("Ce type de congé existe déjà.");
  const t = await ctx.db.leaveType.create({ data: { companyId: ctx.company.id, name: input.name.trim(), annualDays: input.annualDays, paid: input.paid, accrual: input.accrual, carryOverMax: input.carryOverMax, carryOverExpiryMonth: input.carryOverMax > 0 ? input.carryOverExpiryMonth || null : null } });
  await audit(ctx, { action: "hr.leave_type.create", resource: "LeaveType", resourceId: t.id, summary: `${ctx.user.name} a créé le type de congé « ${t.name} ».` });
  return t;
}

export async function updateLeaveType(ctx: Ctx, input: z.output<typeof updateLeaveTypeSchema>) {
  const t = await ctx.db.leaveType.findFirst({ where: { id: input.id } });
  if (!t) throw notFound("Type de congé");
  if (await ctx.db.leaveType.findFirst({ where: { name: input.name.trim(), id: { not: input.id } } })) throw businessRule("Ce type de congé existe déjà.");
  const after = await ctx.db.leaveType.update({ where: { id: input.id }, data: { name: input.name.trim(), annualDays: input.annualDays, paid: input.paid, isActive: input.isActive, accrual: input.accrual, carryOverMax: input.carryOverMax, carryOverExpiryMonth: input.carryOverMax > 0 ? input.carryOverExpiryMonth || null : null } });
  await audit(ctx, { action: "hr.leave_type.update", resource: "LeaveType", resourceId: t.id, summary: `${ctx.user.name} a modifié le type de congé « ${after.name} ».`, before: { annualDays: t.annualDays }, after: { annualDays: after.annualDays } });
  return after;
}

// ═══ Soldes ═══════════════════════════════════════════════════

/** Visibilité : RH et valideurs voient toutes les demandes, les autres uniquement les leurs. */
export const seesAllLeaves = (ctx: Pick<Ctx, "can">) => ctx.can("hr.employee.read") || ctx.can("hr.leave.approve");

/**
 * Soldes d'un salarié pour une année : droit annuel (proratisé à la présence), acquis à la date demandée, report de l'année précédente,
 * pris, en attente, reste. `asOf` : date de référence (par défaut aujourd'hui, ramenée dans l'année). Règles : voir leave-calc.ts.
 */
export async function leaveBalances(ctx: Ctx, employeeId: string, year: number, asOf?: Date) {
  const [types, emp] = await Promise.all([listLeaveTypes(ctx), ctx.db.employee.findFirst({ where: { id: employeeId }, select: { hireDate: true, endDate: true } })]);
  if (!emp) throw notFound("Salarié");
  const ref = asOf ?? new Date();
  const clamped = new Date(Math.min(Math.max(day(ref).getTime(), Date.UTC(year, 0, 1)), Date.UTC(year, 11, 31)));
  const reqs = await ctx.db.leaveRequest.findMany({
    where: { employeeId, status: { in: ["APPROVED", "PENDING"] }, endDate: { gte: new Date(Date.UTC(year - 6, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } },
    select: { typeId: true, status: true, days: true, endDate: true },
  });
  return types.map((t) => {
    const rows: LeaveRow[] = reqs.filter((r) => r.typeId === t.id).map((r) => ({ year: r.endDate.getUTCFullYear(), status: r.status as "APPROVED" | "PENDING", days: Number(r.days), endDate: r.endDate }));
    const b = computeBalance(ruleOf(t), emp, year, clamped, rows);
    const capped = d(t.annualDays).gt(0);
    return {
      type: t, capped, entitlement: capped ? d(b.entitlement) : null, taken: d(b.taken), pending: d(b.pending), remaining: capped ? d(b.remaining) : null,
      accrued: capped ? b.accrued : null, carryOver: b.carryOver, carryExpiresOn: b.carryExpiresOn, available: capped ? b.available : null,
    };
  });
}

// ═══ Demandes ═════════════════════════════════════════════════

export async function listLeaveRequests(ctx: Ctx, p: { status?: string; employeeId?: string; typeId?: string; skip: number; take: number }) {
  let scope: { employeeId?: string } = {};
  if (!seesAllLeaves(ctx)) {
    const me = await employeeOfUser(ctx);
    if (!me) return { total: 0, rows: [] };
    scope = { employeeId: me.id };
  }
  const where = { ...scope, ...(p.status ? { status: p.status as never } : {}), ...(p.employeeId && !scope.employeeId ? { employeeId: p.employeeId } : {}), ...(p.typeId ? { typeId: p.typeId } : {}) };
  const [total, rows] = await Promise.all([
    ctx.db.leaveRequest.count({ where }),
    ctx.db.leaveRequest.findMany({ where, orderBy: [{ startDate: "desc" }], skip: p.skip, take: p.take, include: { employee: { select: { id: true, firstName: true, lastName: true, number: true } }, type: { select: { id: true, name: true, paid: true } } } }),
  ]);
  return { total, rows };
}

export async function getLeaveRequest(ctx: Ctx, id: string) {
  const r = await ctx.db.leaveRequest.findFirst({ where: { id }, include: { employee: { select: { id: true, firstName: true, lastName: true, number: true, userId: true } }, type: true } });
  if (!r) throw notFound("Demande de congé");
  if (!seesAllLeaves(ctx) && r.employee.userId !== ctx.user.id) throw notFound("Demande de congé");
  return r;
}

/**
 * Demande de congé : jours ouvrés calculés par le serveur, pas de chevauchement, plafond annuel respecté,
 * puis validation par un approbateur habilité (jamais le demandeur). S'il n'existe aucun autre approbateur
 * (entreprise à administrateur unique), la demande est acceptée d'office et la décision est tracée.
 */
export async function requestLeave(ctx: Ctx, input: z.output<typeof leaveRequestSchema>) {
  const emp = await ctx.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null } });
  if (!emp) throw notFound("Salarié");
  const forSelf = emp.userId === ctx.user.id;
  if (!(forSelf && ctx.can("hr.leave.request")) && !ctx.can("hr.employee.update")) throw forbidden("Vous ne pouvez demander un congé que pour vous-même (ou en tant que RH).");
  if (emp.status !== "ACTIVE") throw businessRule("Seul un salarié en activité peut poser un congé.");
  const type = await ctx.db.leaveType.findFirst({ where: { id: input.typeId, isActive: true } });
  if (!type) throw notFound("Type de congé");
  const start = day(parseDate(input.startDate)!), end = day(parseDate(input.endDate)!);
  if (end < start) throw businessRule("La fin du congé précède son début.");
  if (start.getUTCFullYear() !== end.getUTCFullYear()) throw businessRule("Une demande ne peut pas chevaucher deux années : faites-en une par année.");
  if (start < emp.hireDate) throw businessRule("Le congé précède la date d'embauche.");
  const cal = await loadCalendar(ctx.db, start, end);
  const days = workingDays(start, end, cal);
  if (days <= 0) throw businessRule("La période ne comporte aucun jour travaillé (week-ends et jours fériés exclus).");
  if (await ctx.db.leaveRequest.findFirst({ where: { employeeId: emp.id, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: end }, endDate: { gte: start } } })) throw businessRule("Une demande de congé existe déjà sur tout ou partie de cette période.");
  if (d(type.annualDays).gt(0)) {
    // solde utilisable pour une période se terminant à cette date (acquisition progressive : seul le constitué à la fin de la période compte)
    const bal = (await leaveBalances(ctx, emp.id, start.getUTCFullYear(), end)).find((b) => b.type.id === type.id)!;
    if (bal.available! < days) throw businessRule(`Solde insuffisant pour « ${type.name} » : ${bal.available} jour(s) disponible(s) à la fin de cette période${type.accrual === "MONTHLY" ? " (droit acquis progressivement)" : ""}, ${days} demandé(s).`);
  }
  const title = `Congé ${emp.firstName} ${emp.lastName} du ${fr(start)} au ${fr(end)}`;
  const { req, auto } = await ctx.tx(async (tx) => {
    const others = await availableApprovers(tx, ctx, "leave", days);
    const auto = others.length === 0;
    const created = await tx.leaveRequest.create({ data: { companyId: ctx.company.id, employeeId: emp.id, typeId: type.id, startDate: start, endDate: end, days, reason: blank(input.reason), status: auto ? "APPROVED" : "PENDING", createdById: ctx.user.id } });
    if (!auto) await requestApproval(tx, ctx, { type: "leave", resourceId: created.id, title, amount: days, detail: `${ctx.user.name} demande ${days} jour${days > 1 ? "s" : ""} de « ${type.name} ».` });
    return { req: created, auto };
  });
  await audit(ctx, { action: "hr.leave.request", resource: "LeaveRequest", resourceId: req.id, summary: `${ctx.user.name} a demandé ${days} jour(s) de « ${type.name} » pour ${emp.firstName} ${emp.lastName} (${iso(start)} → ${iso(end)})${auto ? " — accepté d'office : aucun autre approbateur disponible" : ""}.` });
  return { ...req, autoApproved: auto };
}

/** Annulation : par le salarié lui-même ou par un valideur/RH ; un congé approuvé n'est annulable que s'il n'a pas commencé. */
export async function cancelLeave(ctx: Ctx, id: string) {
  const r = await getLeaveRequest(ctx, id);
  const own = r.employee.userId === ctx.user.id;
  if (!own && !ctx.can("hr.leave.approve") && !ctx.can("hr.employee.update")) throw forbidden();
  if (r.status === "CANCELLED" || r.status === "REJECTED") throw businessRule("Cette demande est déjà clôturée.");
  if (r.status === "APPROVED" && r.startDate <= day(new Date())) throw businessRule("Ce congé a déjà commencé : il ne peut plus être annulé ici.");
  await ctx.tx(async (tx) => { await cancelApprovals(tx, "leave", id); await tx.leaveRequest.update({ where: { id }, data: { status: "CANCELLED" } }); });
  await audit(ctx, { action: "hr.leave.cancel", resource: "LeaveRequest", resourceId: id, summary: `${ctx.user.name} a annulé la demande de congé de ${r.employee.firstName} ${r.employee.lastName} (${iso(r.startDate)} → ${iso(r.endDate)}).` });
}

/** Congés approuvés couvrant une date (pour l'affichage des présences). */
export async function onLeaveOn(db: Pick<Db, "leaveRequest">, date: Date) {
  const rows = await db.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lte: date }, endDate: { gte: date } }, select: { employeeId: true } });
  return new Set(rows.map((r) => r.employeeId));
}
