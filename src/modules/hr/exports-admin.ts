import "server-only";
import type { ExportTable } from "@/core/export/table";
import { num } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { listAdvances } from "./advances";
import { ADVANCE_KINDS, CONDITIONS, DISCIPLINE_STATUSES, VISIT_KINDS, VISIT_STATUSES } from "./admin-schemas";
import { listEquipment } from "./equipment";
import { listVisits } from "./medvisits";
import { listOvertime } from "./overtime";
import { leaveBalanceReport, monthlyReport } from "./reports";
import { listCases } from "./sanctions";

type Ctx = TenantContext;
type Q = (key: string) => string | undefined;
interface Exporter { module?: string; permissions: string[]; build: (ctx: Ctx, q: Q) => Promise<ExportTable> }

const MAX_ROWS = 20_000;
const base = (ctx: Ctx) => ({ company: ctx.company.tradeName ?? ctx.company.legalName, currency: ctx.company.currency, generatedAt: new Date() });
const label = (list: readonly { value: string; label: string }[], v: string | null | undefined) => list.find((x) => x.value === v)?.label ?? v ?? "";
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[]) => allowed.find((a) => a === v);
const REQUEST_STATUS: Record<string, string> = { DRAFT: "Brouillon", PENDING: "En attente", APPROVED: "Approuvé", REJECTED: "Refusé", CANCELLED: "Annulé" };
const dateParam = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00.000Z`) : undefined);
const REQ = ["DRAFT", "PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

/** Exports des registres d'administration RH : mêmes filtres et mêmes droits que les écrans (portée appliquée par les services). */
export const HR_ADMIN_EXPORTERS: Record<string, Exporter> = {
  "hr-heures-supplementaires": {
    module: "hr", permissions: [],
    async build(ctx, q) {
      const { rows } = await listOvertime(ctx, { status: oneOf(q("statut"), REQ), q: q("q"), from: dateParam(q("du")), to: dateParam(q("au")), skip: 0, take: MAX_ROWS });
      return {
        ...base(ctx), title: "Heures supplémentaires",
        columns: [
          { key: "date", label: "Date", type: "date", width: 12 }, { key: "employee", label: "Salarié", width: 22 }, { key: "matricule", label: "Matricule", width: 11 }, { key: "from", label: "De", width: 7 }, { key: "to", label: "À", width: 7 },
          { key: "normal", label: "H. normales prévues", type: "number", width: 12 }, { key: "hours", label: "H. supp. réalisées", type: "number", width: 12 }, { key: "approved", label: "H. approuvées", type: "number", width: 12 },
          { key: "rate", label: "Taux", width: 18 }, { key: "mult", label: "Coefficient", type: "number", width: 10 }, { key: "equiv", label: "H. majorées (équivalent)", type: "number", width: 14 }, { key: "reason", label: "Motif", width: 26 }, { key: "status", label: "Statut", width: 11 },
        ],
        rows: rows.map((r) => ({
          date: r.date, employee: `${r.employee.lastName} ${r.employee.firstName}`, matricule: r.employee.number, from: r.startTime, to: r.endTime, normal: Number(r.normalHours), hours: Number(r.hours), approved: r.approvedHours == null ? null : Number(r.approvedHours),
          rate: r.rate?.name, mult: r.rate ? Number(r.rate.multiplier) : null, equiv: r.rate && r.approvedHours != null ? Math.round(Number(r.approvedHours) * Number(r.rate.multiplier) * 100) / 100 : null, reason: r.reason, status: REQUEST_STATUS[r.status] ?? r.status,
        })),
      };
    },
  },
  "hr-avances": {
    module: "hr", permissions: [],
    async build(ctx, q) {
      const { rows } = await listAdvances(ctx, { status: oneOf(q("statut"), REQ), q: q("q"), skip: 0, take: MAX_ROWS });
      return {
        ...base(ctx), title: "Avances et acomptes sur salaire",
        columns: [
          { key: "date", label: "Date", type: "date", width: 12 }, { key: "employee", label: "Salarié", width: 22 }, { key: "matricule", label: "Matricule", width: 11 }, { key: "kind", label: "Nature", width: 14 }, { key: "amount", label: "Montant", type: "money", width: 14 },
          { key: "inst", label: "Mensualités", type: "number", width: 11 }, { key: "first", label: "1re retenue", type: "date", width: 12 }, { key: "repaid", label: "Remboursé", type: "money", width: 14 }, { key: "balance", label: "Reste", type: "money", width: 14 }, { key: "status", label: "Statut", width: 11 },
        ],
        rows: rows.map((r) => ({ date: r.requestDate, employee: `${r.employee.lastName} ${r.employee.firstName}`, matricule: r.employee.number, kind: label(ADVANCE_KINDS, r.kind), amount: num(r.amount), inst: r.installments, first: r.firstDeductionMonth, repaid: num(r.amount) - r.balance.toNumber(), balance: r.balance.toNumber(), status: REQUEST_STATUS[r.status] ?? r.status })),
      };
    },
  },
  "hr-rapport-mensuel": {
    module: "hr", permissions: ["hr.employee.read"],
    async build(ctx, q) {
      const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(q("mois") ?? "");
      const now = new Date();
      const year = m ? Number(m[1]) : now.getUTCFullYear(), month = m ? Number(m[2]) : now.getUTCMonth() + 1;
      const rep = await monthlyReport(ctx, year, month);
      const cols = [
        { key: "matricule", label: "Matricule", width: 11 }, { key: "employee", label: "Salarié", width: 24 }, { key: "department", label: "Service", width: 16 },
        { key: "leave", label: "Congés (j)", type: "number" as const, width: 10 }, { key: "offDays", label: "Permissions (j)", type: "number" as const, width: 12 }, { key: "offHours", label: "Permissions (h)", type: "number" as const, width: 12 },
        { key: "abs", label: "Absences (j)", type: "number" as const, width: 11 }, { key: "unj", label: "dont injustifiées (j)", type: "number" as const, width: 14 }, { key: "sick", label: "Arrêts maladie (j cal.)", type: "number" as const, width: 14 },
        { key: "late", label: "Retards", type: "number" as const, width: 9 }, { key: "lateMin", label: "Retards (min)", type: "number" as const, width: 11 }, { key: "ot", label: "H. supp. approuvées", type: "number" as const, width: 13 }, { key: "acc", label: "Accidents", type: "number" as const, width: 10 },
      ];
      const row = (r: { number?: string; name?: string; department?: string | null; leaveDays: number | null; timeOffDays: number | null; timeOffHours: number | null; absenceDays: number | null; unjustifiedDays: number | null; sickDays: number | null; lateCount: number | null; lateMinutes: number | null; overtimeHours: number | null; accidents: number | null }) => ({
        matricule: r.number, employee: r.name, department: r.department, leave: r.leaveDays, offDays: r.timeOffDays, offHours: r.timeOffHours, abs: r.absenceDays, unj: r.unjustifiedDays, sick: r.sickDays, late: r.lateCount, lateMin: r.lateMinutes, ot: r.overtimeHours, acc: r.accidents,
      });
      return { ...base(ctx), title: `Rapport RH mensuel ${String(month).padStart(2, "0")}-${year}`, subtitle: "Colonnes selon vos droits ; jours ouvrés (arrêts maladie : jours calendaires)", columns: cols, rows: rep.rows.map(row), totals: { ...row(rep.totals), employee: "Total" } };
    },
  },
  "hr-soldes-conges": {
    module: "hr", permissions: ["hr.employee.read"],
    async build(ctx, q) {
      const year = Number(q("annee")) || new Date().getUTCFullYear();
      const rows = await leaveBalanceReport(ctx, year);
      return {
        ...base(ctx), title: `Soldes de congés ${year}`,
        columns: [
          { key: "matricule", label: "Matricule", width: 11 }, { key: "employee", label: "Salarié", width: 24 }, { key: "type", label: "Type de congé", width: 20 }, { key: "ent", label: "Droit de l'année (j)", type: "number", width: 14 },
          { key: "carry", label: "Report reçu (j)", type: "number", width: 13 }, { key: "taken", label: "Pris (j)", type: "number", width: 9 }, { key: "pending", label: "En attente (j)", type: "number", width: 12 }, { key: "rest", label: "Reste (j)", type: "number", width: 10 },
        ],
        rows: rows.map((r) => ({ matricule: r.number, employee: r.name, type: r.type, ent: r.entitlement, carry: r.carryOver, taken: r.taken, pending: r.pending, rest: r.remaining })),
      };
    },
  },
  "hr-sanctions": {
    module: "hr", permissions: ["hr.sanction.read"],
    async build(ctx, q) {
      const { rows } = await listCases(ctx, { status: oneOf(q("statut"), ["OPEN", "DECIDED", "NOTIFIED", "CLOSED", "CANCELLED"]), q: q("q"), skip: 0, take: MAX_ROWS });
      return {
        ...base(ctx), title: "Registre des sanctions disciplinaires", subtitle: "Confidentiel — suivi de procédure",
        columns: [
          { key: "number", label: "Dossier", width: 14 }, { key: "employee", label: "Salarié", width: 22 }, { key: "matricule", label: "Matricule", width: 11 }, { key: "facts", label: "Date des faits", type: "date", width: 12 }, { key: "breach", label: "Manquement", width: 26 },
          { key: "sanction", label: "Sanction", width: 18 }, { key: "decision", label: "Décision", type: "date", width: 12 }, { key: "notified", label: "Notification", type: "date", width: 12 }, { key: "steps", label: "Étapes", type: "number", width: 8 }, { key: "status", label: "Statut", width: 18 },
        ],
        rows: rows.map((r) => ({ number: r.number, employee: r.employeeName, matricule: r.employeeNumber, facts: r.factsDate, breach: r.breachNature, sanction: r.sanctionType?.name, decision: r.decisionDate, notified: r.notificationDate, steps: r._count.steps, status: label(DISCIPLINE_STATUSES, r.status) })),
      };
    },
  },
  "hr-visites-medicales": {
    module: "hr", permissions: ["hr.medvisit.read"],
    async build(ctx, q) {
      const { rows } = await listVisits(ctx, { status: oneOf(q("statut"), ["PLANNED", "DONE", "CANCELLED"]), kind: oneOf(q("type"), ["HIRING", "PERIODIC", "RETURN", "OTHER"]), q: q("q"), skip: 0, take: MAX_ROWS });
      return {
        ...base(ctx), title: "Suivi des visites médicales", subtitle: "Suivi administratif : aucune donnée médicale",
        columns: [
          { key: "employee", label: "Salarié", width: 22 }, { key: "matricule", label: "Matricule", width: 11 }, { key: "kind", label: "Type", width: 14 }, { key: "planned", label: "Prévue le", type: "date", width: 12 }, { key: "done", label: "Réalisée le", type: "date", width: 12 },
          { key: "provider", label: "Organisme", width: 24 }, { key: "next", label: "Prochaine échéance", type: "date", width: 14 }, { key: "doc", label: "Document d'aptitude", width: 14 }, { key: "status", label: "Statut", width: 12 },
        ],
        rows: rows.map((r) => ({ employee: `${r.employee.lastName} ${r.employee.firstName}`, matricule: r.employee.number, kind: label(VISIT_KINDS, r.kind), planned: r.scheduledOn, done: r.doneOn, provider: r.provider, next: r.nextDueOn, doc: r.aptitudeDoc === "PROVIDED" ? "Reçu" : r.aptitudeDoc === "PENDING" ? "Attendu" : "Sans objet", status: label(VISIT_STATUSES, r.status) })),
      };
    },
  },
  "hr-equipements": {
    module: "hr", permissions: ["hr.equipment.read"],
    async build(ctx, q) {
      const { rows } = await listEquipment(ctx, { status: oneOf(q("statut"), ["OUT", "RETURNED"]), q: q("q"), skip: 0, take: MAX_ROWS });
      return {
        ...base(ctx), title: "Équipements et EPI remis",
        columns: [
          { key: "employee", label: "Salarié", width: 22 }, { key: "matricule", label: "Matricule", width: 11 }, { key: "name", label: "Équipement", width: 24 }, { key: "ref", label: "Référence", width: 14 }, { key: "qty", label: "Qté", type: "number", width: 6 },
          { key: "issued", label: "Remis le", type: "date", width: 12 }, { key: "cond", label: "État", width: 11 }, { key: "replace", label: "Remplacement prévu", type: "date", width: 14 }, { key: "returned", label: "Restitué le", type: "date", width: 12 }, { key: "rcond", label: "État à la restitution", width: 14 }, { key: "resp", label: "Responsable", width: 18 },
        ],
        rows: rows.map((r) => ({ employee: `${r.employee.lastName} ${r.employee.firstName}`, matricule: r.employee.number, name: r.name, ref: r.reference, qty: r.quantity, issued: r.issuedOn, cond: label(CONDITIONS, r.condition), replace: r.replaceOn, returned: r.returnedOn, rcond: r.returnCondition ? label(CONDITIONS, r.returnCondition) : "", resp: r.responsibleName })),
      };
    },
  },
};
