import "server-only";
import { z } from "zod";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { businessRule } from "@/core/errors";
import { d, roundMoney, type Decimal } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { formatMoney } from "@/lib/reference-data";
import { workingDays, type WorkCalendar } from "./leave-calc";
import { loadPolicy, type HrPolicy } from "./policy";
import { workWindows } from "./time";

type Ctx = TenantContext;

/**
 * Liaison RH → paie. PRINCIPES :
 *  - tout est DÉSACTIVÉ par défaut et se règle par l'entreprise (« Paie › Éléments RH ») : aucune règle de retenue ou de majoration n'est présumée ;
 *  - rien n'est écrit dans les bulletins à l'insu de la RH : le calcul d'une campagne en brouillon est rejouable, et ce qui est retenu est listé (PayrollHrLink) ;
 *  - la consommation (heures payées, avance remboursée) n'est enregistrée qu'à la VALIDATION de la campagne, à partir de ce qui a été calculé, et se défait
 *    si la campagne est annulée ; une campagne payée ne s'annule plus. Jamais de double paiement ni de double déduction (marqueur + contrainte unique).
 *  - arrêts maladie : aucune retenue ni indemnité (règles de maintien de salaire à valider avant) ; ils restent hors de la paie.
 */

export const payrollLinkSchema = z.object({
  payrollUnpaidTimeOff: z.boolean().default(false),
  payrollUnpaidAbsences: z.boolean().default(false),
  payrollOvertime: z.boolean().default(false),
  payrollAdvances: z.boolean().default(false),
  payrollMonthlyHours: z.union([z.literal(""), z.coerce.number().gt(0, "Heures positives").max(744)]).nullable().optional(),
});

export async function savePayrollLink(ctx: Ctx, input: z.output<typeof payrollLinkSchema>) {
  const hours = input.payrollMonthlyHours === "" || input.payrollMonthlyHours == null ? null : input.payrollMonthlyHours;
  if (input.payrollOvertime && hours == null) throw businessRule("Pour payer les heures supplémentaires, renseignez les heures mensuelles de référence (taux horaire = salaire de base ÷ heures).");
  const data = { payrollUnpaidTimeOff: input.payrollUnpaidTimeOff, payrollUnpaidAbsences: input.payrollUnpaidAbsences, payrollOvertime: input.payrollOvertime, payrollAdvances: input.payrollAdvances, payrollMonthlyHours: hours };
  const before = (await loadPolicy(ctx.db)).payroll;
  await ctx.db.hrSettings.upsert({ where: { companyId: ctx.company.id }, create: { companyId: ctx.company.id, ...data }, update: data });
  await audit(ctx, { action: "hr.payroll_link.update", resource: "HrSettings", summary: `${ctx.user.name} a modifié la liaison RH → paie.`, before, after: data });
}

// ═══ Calculs purs ═════════════════════════════════════════════

const monthIndex = (v: Date) => v.getUTCFullYear() * 12 + v.getUTCMonth();

/**
 * Montant à retenir ce mois-ci sur une avance : mensualité = montant ÷ nombre de mensualités ; la retenue démarre au premier mois prévu et
 * rattrape les mois manqués (objectif cumulé) ; la dernière mensualité solde le reste. Jamais plus que le reste à régulariser.
 */
export function advanceDue(a: { amount: Decimal; installments: number; firstDeductionMonth: Date }, repaid: Decimal, month: Date, currency: string): Decimal {
  const idx = monthIndex(month) - monthIndex(a.firstDeductionMonth);
  if (idx < 0) return d(0);
  const total = d(a.amount);
  const target = idx >= a.installments - 1 ? total : roundMoney(total.div(a.installments).mul(idx + 1), currency);
  const due = target.minus(repaid);
  const balance = total.minus(repaid);
  return due.lte(0) ? d(0) : due.gt(balance) ? balance : due;
}

/** Durée de la journée de référence (heures), pour convertir une permission horaire non rémunérée en jours. */
export const dayHoursOf = (schedule: HrPolicy["schedule"]) => workWindows(schedule).reduce((s, [a, b]) => s + (b - a), 0) / 60;

// ═══ Éléments RH d'un salarié pour une période de paie ════════

export interface HrPayrollExtra { name: string; type: "EARNING" | "DEDUCTION"; category: "OTHER"; amount: Decimal; taxable: boolean }
export interface HrPayrollLine { kind: "TIMEOFF" | "ABSENCE" | "OVERTIME" | "ADVANCE"; label: string; detail: string }
export interface HrPayrollVars {
  unpaidDays: number;
  extras: HrPayrollExtra[];
  lines: HrPayrollLine[];
  warnings: string[];
  links: { kind: "OVERTIME" | "ADVANCE"; refId: string; amount: Decimal; hours: number | null }[];
}

const fr = (v: Date) => v.toLocaleDateString("fr-FR", { timeZone: "UTC" });
const clipDays = (s: Date, e: Date, from: Date, to: Date, cal: WorkCalendar) => workingDays(s > from ? s : from, e < to ? e : to, cal);

/**
 * Éléments RH à intégrer à la paie d'un salarié sur [from ; to] (à l'intérieur du mois `monthStart`) selon les réglages de l'entreprise.
 * Lecture seule : sert au calcul des campagnes ET à l'aperçu (mêmes chiffres).
 */
export async function hrPayrollVars(db: Db, e: { id: string; baseSalary: unknown }, p: { monthStart: Date; monthEnd: Date; from: Date; to: Date; cal: WorkCalendar; currency: string; policy: HrPolicy }): Promise<HrPayrollVars> {
  const out: HrPayrollVars = { unpaidDays: 0, extras: [], lines: [], warnings: [], links: [] };
  const pol = p.policy.payroll;

  if (pol.unpaidTimeOff) {
    const dayH = dayHoursOf(p.policy.schedule);
    const offs = await db.timeOffRequest.findMany({ where: { employeeId: e.id, status: "APPROVED", paid: false, startDate: { lte: p.to }, endDate: { gte: p.from } }, include: { type: { select: { name: true } } } });
    for (const o of offs) {
      const days = o.unit === "DAILY" ? clipDays(o.startDate, o.endDate, p.from, p.to, p.cal) : Math.round((Number(o.hours) / dayH) * 100) / 100;
      if (days <= 0) continue;
      out.unpaidDays += days;
      out.lines.push({ kind: "TIMEOFF", label: `Permission non rémunérée « ${o.type.name} »`, detail: `${o.unit === "DAILY" ? `${days} j` : `${Number(o.hours)} h (≈ ${days} j)`} · ${fr(o.startDate)}` });
    }
  }
  if (pol.unpaidAbsences) {
    const abs = await db.absenceRecord.findMany({ where: { employeeId: e.id, status: "APPROVED", type: { deductFromPay: true }, startDate: { lte: p.to }, endDate: { gte: p.from } }, include: { type: { select: { name: true } } } });
    for (const a of abs) {
      const days = a.halfDay ? 0.5 : clipDays(a.startDate, a.endDate, p.from, p.to, p.cal);
      if (days <= 0) continue;
      out.unpaidDays += days;
      out.lines.push({ kind: "ABSENCE", label: `Absence « ${a.type.name} » (retenue prévue par l'entreprise)`, detail: `${days} j · ${fr(a.startDate)}` });
    }
  }
  if (pol.overtime) {
    const rows = await db.overtimeRecord.findMany({ where: { employeeId: e.id, status: "APPROVED", payrollPeriod: null, approvedHours: { gt: 0 }, date: { lte: p.monthEnd } }, include: { rate: true }, orderBy: { date: "asc" } });
    const byRate = new Map<string, { name: string; mult: Decimal; hours: Decimal; ids: { id: string; hours: Decimal }[] }>();
    for (const r of rows) {
      if (!r.rate) { out.warnings.push(`Heures supplémentaires du ${fr(r.date)} sans taux de majoration : non payées (affectez un taux).`); continue; }
      const g = byRate.get(r.rate.id) ?? { name: r.rate.name, mult: d(r.rate.multiplier), hours: d(0), ids: [] };
      g.hours = g.hours.plus(d(r.approvedHours)); g.ids.push({ id: r.id, hours: d(r.approvedHours) });
      byRate.set(r.rate.id, g);
    }
    const monthly = pol.monthlyHours;
    for (const g of byRate.values()) {
      if (!monthly) { out.warnings.push("Heures mensuelles de référence non renseignées : heures supplémentaires non payées."); break; }
      const hourly = d(e.baseSalary as never).div(monthly);
      const total = roundMoney(hourly.mul(g.mult).mul(g.hours), p.currency);
      if (total.lte(0)) continue;
      out.extras.push({ name: `Heures supplémentaires — ${g.name} (${g.hours.toString()} h × ${g.mult.toString()})`, type: "EARNING", category: "OTHER", amount: total, taxable: true });
      out.lines.push({ kind: "OVERTIME", label: `Heures supplémentaires — ${g.name}`, detail: `${g.hours.toString()} h × ${g.mult.toString()} × taux horaire ${formatMoney(hourly.toNumber(), p.currency)}` });
      // le montant d'une ligne de lien est la part proportionnelle de chaque déclaration (somme = total payé)
      let acc = d(0);
      g.ids.forEach((x, i) => {
        const part = i === g.ids.length - 1 ? total.minus(acc) : roundMoney(total.mul(x.hours).div(g.hours), p.currency);
        acc = acc.plus(part);
        out.links.push({ kind: "OVERTIME", refId: x.id, amount: part, hours: x.hours.toNumber() });
      });
    }
  }
  if (pol.advances) {
    const advs = await db.salaryAdvance.findMany({ where: { employeeId: e.id, status: "APPROVED", firstDeductionMonth: { lte: p.monthStart } }, include: { repayments: { select: { amount: true, period: true } } } });
    const period = `${p.monthStart.getUTCFullYear()}-${String(p.monthStart.getUTCMonth() + 1).padStart(2, "0")}`;
    for (const a of advs) {
      // les retenues déjà faites sur ce mois (campagne validée puis annulée → retirées) ne comptent pas : la période est recalculée
      const repaid = a.repayments.filter((r) => r.period !== period).reduce((s, r) => s.plus(d(r.amount)), d(0));
      const due = advanceDue({ amount: d(a.amount), installments: a.installments, firstDeductionMonth: a.firstDeductionMonth }, repaid, p.monthStart, p.currency);
      if (due.lte(0)) continue;
      out.extras.push({ name: `Retenue ${a.kind === "ACOMPTE" ? "acompte" : "avance"} du ${fr(a.requestDate)}`, type: "DEDUCTION", category: "OTHER", amount: due, taxable: false });
      out.lines.push({ kind: "ADVANCE", label: `Retenue ${a.kind === "ACOMPTE" ? "d'acompte" : "d'avance"} du ${fr(a.requestDate)}`, detail: `${formatMoney(due.toNumber(), p.currency)} (montant ${formatMoney(d(a.amount).toNumber(), p.currency)}, ${a.installments} mensualité(s))` });
      out.links.push({ kind: "ADVANCE", refId: a.id, amount: due, hours: null });
    }
  }
  out.unpaidDays = Math.round(out.unpaidDays * 100) / 100;
  return out;
}

// ═══ Consommation à la validation, retrait à l'annulation ═════

const periodOf = (run: { year: number; month: number }) => `${run.year}-${String(run.month).padStart(2, "0")}`;

/**
 * Validation d'une campagne : les heures payées sont marquées (une seule fois) et les retenues d'avance enregistrées comme remboursements de paie
 * (unique par avance et par période). Se fait dans la transaction de validation : si l'un échoue, la validation échoue.
 */
export async function consumeOnValidation(tx: Db, ctx: Ctx, run: { id: string; year: number; month: number }) {
  const period = periodOf(run);
  const links = await tx.payrollHrLink.findMany({ where: { runId: run.id } });
  const monthEnd = new Date(Date.UTC(run.year, run.month, 0));
  for (const l of links) {
    if (l.kind === "OVERTIME") {
      const res = await tx.overtimeRecord.updateMany({ where: { id: l.refId, status: "APPROVED", payrollPeriod: null }, data: { payrollPeriod: period } });
      if (res.count !== 1) throw businessRule("Des heures supplémentaires de cette campagne ont changé (annulées ou déjà payées) depuis le calcul : recalculez la campagne.");
    } else {
      const adv = await tx.salaryAdvance.findFirst({ where: { id: l.refId, status: "APPROVED" }, include: { repayments: { select: { amount: true } } } });
      if (!adv) throw businessRule("Une avance de cette campagne a changé depuis le calcul : recalculez la campagne.");
      const balance = d(adv.amount).minus(adv.repayments.reduce((s, r) => s.plus(d(r.amount)), d(0)));
      if (d(l.amount).gt(balance)) throw businessRule("Une retenue d'avance dépasse le reste à régulariser (remboursement saisi depuis le calcul) : recalculez la campagne.");
      await tx.advanceRepayment.create({ data: { companyId: ctx.company.id, advanceId: adv.id, date: monthEnd, amount: l.amount.toString(), source: "PAYROLL", period, note: `Retenue sur la paie ${period}`, createdById: ctx.user.id } });
    }
  }
}

/** Annulation d'une campagne VALIDÉE : les heures redeviennent payables et les retenues d'avance sont retirées (une campagne payée ne s'annule plus). */
export async function releaseOnCancel(tx: Db, run: { id: string; year: number; month: number }) {
  const period = periodOf(run);
  const links = await tx.payrollHrLink.findMany({ where: { runId: run.id } });
  const overtime = links.filter((l) => l.kind === "OVERTIME").map((l) => l.refId);
  const advances = links.filter((l) => l.kind === "ADVANCE").map((l) => l.refId);
  if (overtime.length) await tx.overtimeRecord.updateMany({ where: { id: { in: overtime }, payrollPeriod: period }, data: { payrollPeriod: null } });
  if (advances.length) await tx.advanceRepayment.deleteMany({ where: { advanceId: { in: advances }, period, source: "PAYROLL" } });
}

/** Remplace les liens d'une campagne par ceux du dernier calcul. */
export async function saveLinks(tx: Db, ctx: Ctx, runId: string, rows: { employeeId: string; vars: HrPayrollVars }[]) {
  await tx.payrollHrLink.deleteMany({ where: { runId } });
  const data = rows.flatMap((r) => r.vars.links.map((l) => ({ companyId: ctx.company.id, runId, employeeId: r.employeeId, kind: l.kind, refId: l.refId, amount: l.amount.toString(), hours: l.hours })));
  if (data.length) await tx.payrollHrLink.createMany({ data });
}

// ═══ Aperçu (lecture seule) ═══════════════════════════════════

/** Éléments RH qu'une campagne en brouillon intégrerait pour le mois, salarié par salarié ; même calcul que la campagne. */
export async function hrPayrollPreview(ctx: Ctx, year: number, month: number) {
  const { loadCalendar } = await import("./calendar");
  const policy = await loadPolicy(ctx.db);
  const monthStart = new Date(Date.UTC(year, month - 1, 1)), monthEnd = new Date(Date.UTC(year, month, 0));
  const cal = await loadCalendar(ctx.db, monthStart, monthEnd);
  const employees = await ctx.db.employee.findMany({ where: { deletedAt: null, hireDate: { lte: monthEnd }, OR: [{ endDate: null }, { endDate: { gte: monthStart } }] }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
  const rows: { employeeId: string; name: string; number: string; vars: HrPayrollVars }[] = [];
  for (const e of employees) {
    const from = e.hireDate > monthStart ? e.hireDate : monthStart;
    const to = e.endDate && e.endDate < monthEnd ? e.endDate : monthEnd;
    const vars = await hrPayrollVars(ctx.db, e, { monthStart, monthEnd, from, to, cal, currency: ctx.company.currency, policy });
    if (vars.lines.length || vars.warnings.length) rows.push({ employeeId: e.id, name: `${e.lastName} ${e.firstName}`, number: e.number, vars });
  }
  return { enabled: Object.values(policy.payroll).some((v) => v === true), policy: policy.payroll, rows };
}
