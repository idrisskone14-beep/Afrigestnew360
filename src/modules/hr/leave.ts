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
import { employeeOfUser } from "./employees";
import type { leaveRequestSchema, leaveTypeSchema, updateLeaveTypeSchema } from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const DAY = 86_400_000;
const day = (v: Date) => new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
const iso = (v: Date) => v.toISOString().slice(0, 10);
const fr = (v: Date) => v.toLocaleDateString("fr-FR", { timeZone: "UTC" });

/** Jours ouvrés (lundi à vendredi) entre deux dates incluses. Les jours fériés ne sont pas déduits (non paramétrés). */
export function workingDays(start: Date, end: Date): number {
  let n = 0;
  for (let t = day(start).getTime(); t <= day(end).getTime(); t += DAY) { const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

// ═══ Types de congé ═══════════════════════════════════════════

export const listLeaveTypes = (ctx: Ctx, includeInactive = false) => ctx.db.leaveType.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { name: "asc" } });

export async function createLeaveType(ctx: Ctx, input: z.output<typeof leaveTypeSchema>) {
  if (await ctx.db.leaveType.findFirst({ where: { name: input.name.trim() } })) throw businessRule("Ce type de congé existe déjà.");
  const t = await ctx.db.leaveType.create({ data: { companyId: ctx.company.id, name: input.name.trim(), annualDays: input.annualDays, paid: input.paid } });
  await audit(ctx, { action: "hr.leave_type.create", resource: "LeaveType", resourceId: t.id, summary: `${ctx.user.name} a créé le type de congé « ${t.name} ».` });
  return t;
}

export async function updateLeaveType(ctx: Ctx, input: z.output<typeof updateLeaveTypeSchema>) {
  const t = await ctx.db.leaveType.findFirst({ where: { id: input.id } });
  if (!t) throw notFound("Type de congé");
  if (await ctx.db.leaveType.findFirst({ where: { name: input.name.trim(), id: { not: input.id } } })) throw businessRule("Ce type de congé existe déjà.");
  const after = await ctx.db.leaveType.update({ where: { id: input.id }, data: { name: input.name.trim(), annualDays: input.annualDays, paid: input.paid, isActive: input.isActive } });
  await audit(ctx, { action: "hr.leave_type.update", resource: "LeaveType", resourceId: t.id, summary: `${ctx.user.name} a modifié le type de congé « ${after.name} ».`, before: { annualDays: t.annualDays }, after: { annualDays: after.annualDays } });
  return after;
}

// ═══ Soldes ═══════════════════════════════════════════════════

/** Visibilité : RH et valideurs voient toutes les demandes, les autres uniquement les leurs. */
export const seesAllLeaves = (ctx: Pick<Ctx, "can">) => ctx.can("hr.employee.read") || ctx.can("hr.leave.approve");

export async function leaveBalances(ctx: Ctx, employeeId: string, year: number) {
  const types = await listLeaveTypes(ctx);
  const from = new Date(Date.UTC(year, 0, 1)), to = new Date(Date.UTC(year, 11, 31));
  const reqs = await ctx.db.leaveRequest.findMany({ where: { employeeId, status: { in: ["APPROVED", "PENDING"] }, startDate: { gte: from, lte: to } }, select: { typeId: true, status: true, days: true } });
  return types.map((t) => {
    const taken = reqs.filter((r) => r.typeId === t.id && r.status === "APPROVED").reduce((a, r) => a.plus(r.days), d(0));
    const pending = reqs.filter((r) => r.typeId === t.id && r.status === "PENDING").reduce((a, r) => a.plus(r.days), d(0));
    const capped = d(t.annualDays).gt(0);
    return { type: t, entitlement: capped ? d(t.annualDays) : null, taken, pending, remaining: capped ? d(t.annualDays).minus(taken).minus(pending) : null };
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
  const days = workingDays(start, end);
  if (days <= 0) throw businessRule("La période ne comporte aucun jour ouvré.");
  if (await ctx.db.leaveRequest.findFirst({ where: { employeeId: emp.id, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: end }, endDate: { gte: start } } })) throw businessRule("Une demande de congé existe déjà sur tout ou partie de cette période.");
  if (d(type.annualDays).gt(0)) {
    const bal = (await leaveBalances(ctx, emp.id, start.getUTCFullYear())).find((b) => b.type.id === type.id)!;
    if (bal.remaining!.lt(days)) throw businessRule(`Solde insuffisant pour « ${type.name} » : ${bal.remaining!.toNumber()} jour(s) restant(s), ${days} demandé(s).`);
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
