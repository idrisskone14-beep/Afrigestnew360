import "server-only";
import type { z } from "zod";
import { audit } from "@/core/audit";
import { availableApprovers, cancelApprovals, requestApproval } from "@/core/approvals";
import { businessRule, forbidden, notFound } from "@/core/errors";
import { d, roundMoney } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { formatMoney } from "@/lib/reference-data";
import "@/modules/registry";
import type { advanceSchema, repaymentSchema, updateAdvanceSchema } from "./admin-schemas";
import { ADVANCE_SCOPE, assertCan, assertInScope, employeeFilter, scopeOf } from "./scope";
import { dayOf, parseDay } from "./time";

type Ctx = TenantContext;
const fr = (v: Date) => v.toLocaleDateString("fr-FR", { timeZone: "UTC" });
const monthStart = (v: Date) => new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), 1));

/** Reste à régulariser = montant - remboursements enregistrés (calculé, jamais stocké : une seule source). */
export const advanceBalance = (a: { amount: unknown }, repayments: { amount: unknown }[]) => d(a.amount as never).minus(repayments.reduce((s, r) => s.plus(d(r.amount as never)), d(0)));

const include = { employee: { select: { id: true, firstName: true, lastName: true, number: true, userId: true } }, repayments: { orderBy: { date: "asc" as const } } };

export async function listAdvances(ctx: Ctx, p: { status?: string; employeeId?: string; q?: string; skip: number; take: number }) {
  const scope = await scopeOf(ctx, ADVANCE_SCOPE);
  if (scope.kind === "none") return { total: 0, rows: [], scope };
  const where = {
    ...employeeFilter(scope),
    ...(p.status ? { status: p.status as never } : {}),
    ...(p.employeeId && scope.kind === "all" ? { employeeId: p.employeeId } : {}),
    ...(p.q ? { OR: [{ employee: { lastName: { contains: p.q, mode: "insensitive" as const } } }, { employee: { firstName: { contains: p.q, mode: "insensitive" as const } } }, { employee: { number: { contains: p.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.salaryAdvance.count({ where }),
    ctx.db.salaryAdvance.findMany({ where, orderBy: [{ requestDate: "desc" }, { createdAt: "desc" }], skip: p.skip, take: p.take, include }),
  ]);
  return { total, rows: rows.map((r) => ({ ...r, balance: advanceBalance(r, r.repayments) })), scope };
}

export async function getAdvance(ctx: Ctx, id: string) {
  const r = await ctx.db.salaryAdvance.findFirst({ where: { id }, include });
  if (!r) throw notFound("Avance");
  assertInScope(await scopeOf(ctx, ADVANCE_SCOPE), r.employeeId, "Avance");
  return { ...r, balance: advanceBalance(r, r.repayments) };
}

function assertMayActFor(ctx: Ctx, employeeUserId: string | null) {
  const self = employeeUserId === ctx.user.id && ctx.can("hr.advance.request");
  if (!self && !ctx.can("hr.advance.manage")) throw forbidden("Vous ne pouvez demander une avance que pour vous-même (ou en tant que RH).");
}

function normalize(input: { amount: number; requestDate: string; installments: number; firstDeductionMonth: string }, currency: string) {
  const requestDate = parseDay(input.requestDate), first = parseDay(input.firstDeductionMonth);
  if (!requestDate || !first) throw businessRule("Date invalide.");
  if (requestDate > dayOf(new Date())) throw businessRule("La date de la demande ne peut pas être dans le futur.");
  const firstMonth = monthStart(first);
  if (firstMonth < monthStart(requestDate)) throw businessRule("Le premier mois de retenue ne peut pas précéder la demande.");
  const amount = roundMoney(input.amount, currency);
  if (amount.lte(0)) throw businessRule("Le montant doit être positif.");
  return { requestDate, firstMonth, amount };
}

export async function createAdvance(ctx: Ctx, input: z.output<typeof advanceSchema>) {
  const emp = await ctx.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null } });
  if (!emp) throw notFound("Salarié");
  assertMayActFor(ctx, emp.userId);
  if (emp.status !== "ACTIVE") throw businessRule("Seul un salarié en activité peut demander une avance.");
  const n = normalize(input, ctx.company.currency);
  if (n.requestDate < emp.hireDate) throw businessRule("La demande précède l'embauche.");
  const row = await ctx.db.salaryAdvance.create({ data: { companyId: ctx.company.id, employeeId: emp.id, kind: input.kind, amount: n.amount.toString(), requestDate: n.requestDate, reason: input.reason?.trim() || null, installments: input.installments, firstDeductionMonth: n.firstMonth, status: "DRAFT", createdById: ctx.user.id } });
  await audit(ctx, { action: "hr.advance.create", resource: "SalaryAdvance", resourceId: row.id, summary: `${ctx.user.name} a enregistré une demande d'${input.kind === "ACOMPTE" ? "acompte" : "avance"} de ${formatMoney(n.amount.toNumber(), ctx.company.currency)} pour ${emp.firstName} ${emp.lastName}.` });
  return input.submit ? submitAdvance(ctx, row.id) : { ...row, autoApproved: false };
}

export async function updateAdvance(ctx: Ctx, input: z.output<typeof updateAdvanceSchema>) {
  const r = await getAdvance(ctx, input.id);
  assertMayActFor(ctx, r.employee.userId);
  if (r.status !== "DRAFT") throw businessRule(r.status === "APPROVED" ? "Cette avance est approuvée : annulez-la (si aucun remboursement) et refaites une demande." : r.status === "PENDING" ? "Cette demande est en cours de validation : annulez-la pour la modifier." : "Cette demande est clôturée.");
  const n = normalize(input, ctx.company.currency);
  return ctx.db.salaryAdvance.update({ where: { id: r.id }, data: { kind: input.kind, amount: n.amount.toString(), requestDate: n.requestDate, reason: input.reason?.trim() || null, installments: input.installments, firstDeductionMonth: n.firstMonth } });
}

/** Soumission au moteur de validation global (montant en monnaie : règles à étapes et seuils de l'entreprise). */
export async function submitAdvance(ctx: Ctx, id: string) {
  const r = await getAdvance(ctx, id);
  assertMayActFor(ctx, r.employee.userId);
  if (r.status !== "DRAFT") throw businessRule("Seul un brouillon peut être soumis.");
  const amount = d(r.amount).toNumber();
  const title = `${r.kind === "ACOMPTE" ? "Acompte" : "Avance"} ${r.employee.firstName} ${r.employee.lastName} : ${formatMoney(amount, ctx.company.currency)} en ${r.installments} mensualité(s)`;
  const out = await ctx.tx(async (tx) => {
    const auto = (await availableApprovers(tx, ctx, "advance", amount)).length === 0;
    const row = await tx.salaryAdvance.update({
      where: { id: r.id },
      data: auto ? { status: "APPROVED", submittedAt: new Date(), decidedById: ctx.user.id, decidedAt: new Date(), decisionComment: "Accordée d'office : aucun autre approbateur disponible" } : { status: "PENDING", submittedAt: new Date() },
    });
    if (!auto) await requestApproval(tx, ctx, { type: "advance", resourceId: r.id, title, amount });
    return { row, auto };
  });
  await audit(ctx, { action: "hr.advance.submit", resource: "SalaryAdvance", resourceId: r.id, summary: `${ctx.user.name} a soumis la demande d'avance de ${r.employee.firstName} ${r.employee.lastName}${out.auto ? " — accordée d'office : aucun autre approbateur disponible" : " à validation"}.` });
  return { ...out.row, autoApproved: out.auto };
}

/** Annulation : tant qu'aucun remboursement n'est enregistré (sinon l'historique financier serait faussé). */
export async function cancelAdvance(ctx: Ctx, id: string) {
  const r = await getAdvance(ctx, id);
  const own = r.employee.userId === ctx.user.id;
  if (!own && !ctx.can("hr.advance.approve") && !ctx.can("hr.advance.manage")) throw forbidden();
  if (r.status === "CANCELLED" || r.status === "REJECTED") throw businessRule("Cette demande est déjà clôturée.");
  if (r.repayments.length > 0) throw businessRule("Des remboursements sont déjà enregistrés : l'avance ne peut plus être annulée.");
  if (r.status === "APPROVED" && !ctx.can("hr.advance.manage")) throw businessRule("Cette avance est approuvée : seule la RH peut l'annuler.");
  await ctx.tx(async (tx) => { await cancelApprovals(tx, "advance", id); await tx.salaryAdvance.update({ where: { id }, data: { status: "CANCELLED" } }); });
  await audit(ctx, { action: "hr.advance.cancel", resource: "SalaryAdvance", resourceId: id, summary: `${ctx.user.name} a annulé la demande d'avance de ${r.employee.firstName} ${r.employee.lastName}.` });
}

/**
 * Remboursement manuel (espèces, virement…) d'une avance approuvée. Le reste à régulariser est vérifié sous verrou de ligne : deux saisies simultanées
 * ne peuvent pas dépasser le montant. Une retenue sur bulletin utilisera la même table avec une `period` unique par avance (jamais de double déduction).
 */
export async function recordRepayment(ctx: Ctx, input: z.output<typeof repaymentSchema>) {
  assertCan(ctx, "hr.advance.manage");
  const date = parseDay(input.date);
  if (!date) throw businessRule("Date invalide.");
  if (date > dayOf(new Date())) throw businessRule("La date du remboursement ne peut pas être dans le futur.");
  const amount = roundMoney(input.amount, ctx.company.currency);
  const a = await ctx.tx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "SalaryAdvance" WHERE id = ${input.advanceId}::uuid FOR UPDATE`;
    const adv = await tx.salaryAdvance.findFirst({ where: { id: input.advanceId }, include });
    if (!adv) throw notFound("Avance");
    if (adv.status !== "APPROVED") throw businessRule("Seule une avance approuvée peut être remboursée.");
    if (date < adv.requestDate) throw businessRule("Le remboursement précède la demande.");
    const balance = advanceBalance(adv, adv.repayments);
    if (amount.gt(balance)) throw businessRule(`Le remboursement dépasse le reste à régulariser (${formatMoney(balance.toNumber(), ctx.company.currency)}).`);
    await tx.advanceRepayment.create({ data: { companyId: ctx.company.id, advanceId: adv.id, date, amount: amount.toString(), source: "MANUAL", note: input.note?.trim() || null, createdById: ctx.user.id } });
    return { adv, balance: balance.minus(amount) };
  });
  await audit(ctx, { action: "hr.advance.repay", resource: "SalaryAdvance", resourceId: input.advanceId, summary: `${ctx.user.name} a enregistré un remboursement de ${formatMoney(amount.toNumber(), ctx.company.currency)} (${fr(date)}) sur l'avance de ${a.adv.employee.firstName} ${a.adv.employee.lastName}. Reste : ${formatMoney(a.balance.toNumber(), ctx.company.currency)}.` });
}

/** Avances approuvées non soldées (base de la future retenue sur paie ; à lire par le module Paie, jamais à modifier directement). */
export async function outstandingAdvances(ctx: Ctx) {
  assertCan(ctx, "hr.advance.read");
  const rows = await ctx.db.salaryAdvance.findMany({ where: { status: "APPROVED" }, include });
  return rows.map((r) => ({ ...r, balance: advanceBalance(r, r.repayments) })).filter((r) => r.balance.gt(0));
}
