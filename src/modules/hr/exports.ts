import "server-only";
import type { ExportTable } from "@/core/export/table";
import type { TenantContext } from "@/core/tenant/context";
import { listAbsences } from "./absences";
import { HR_ADMIN_EXPORTERS } from "./exports-admin";
import { listAccidents } from "./accidents";
import { listLateness } from "./lateness";
import { CERTIFICATE_STATUSES, SICK_STATUSES } from "./registers-schemas";
import { CONTRACT_TYPES } from "./schemas";
import { ABSENCE_CATEGORIES, ACCIDENT_KINDS, ACCIDENT_STATUSES, CNPS_STATUSES, JUSTIFICATIONS, QUALIFICATIONS } from "./registers-schemas";
import { listSickLeaves } from "./sickleave";
import { staffRegister } from "./staff";
import { listTimeOffs } from "./timeoff";

type Ctx = TenantContext;
type Q = (key: string) => string | undefined;
interface Exporter { module?: string; permissions: string[]; build: (ctx: Ctx, q: Q) => Promise<ExportTable> }

const MAX_ROWS = 20_000;
const base = (ctx: Ctx) => ({ company: ctx.company.tradeName ?? ctx.company.legalName, currency: ctx.company.currency, generatedAt: new Date() });
const label = (list: readonly { value: string; label: string }[], v: string | null | undefined) => list.find((x) => x.value === v)?.label ?? v ?? "";
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[]) => allowed.find((a) => a === v);
const REQUEST_STATUS: Record<string, string> = { DRAFT: "Brouillon", PENDING: "En attente", APPROVED: "Approuvé", REJECTED: "Refusé", CANCELLED: "Annulé" };
const dateParam = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00.000Z`) : undefined);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Exports (CSV, Excel, PDF) des registres RH : mêmes filtres et mêmes droits que les écrans (le service applique la portée de l'utilisateur). */
export const HR_EXPORTERS: Record<string, Exporter> = {
  "hr-accidents": {
    module: "hr", permissions: ["hr.accident.read"],
    async build(ctx, q) {
      const { rows } = await listAccidents(ctx, { q: q("q"), status: oneOf(q("statut"), ["OPEN", "CLOSED", "ARCHIVED"]), kind: oneOf(q("type"), ["WORKPLACE", "COMMUTE", "MISSION"]), cnps: oneOf(q("cnps"), ["TO_DECLARE", "DECLARED", "ACKNOWLEDGED", "NOT_REQUIRED"]), skip: 0, take: MAX_ROWS });
      return {
        ...base(ctx), title: "Registre des accidents de travail",
        columns: [
          { key: "number", label: "Dossier", width: 14 }, { key: "date", label: "Date", type: "date", width: 12 }, { key: "time", label: "Heure", width: 7 }, { key: "employee", label: "Salarié", width: 22 }, { key: "matricule", label: "Matricule", width: 11 },
          { key: "department", label: "Service", width: 16 }, { key: "kind", label: "Type", width: 16 }, { key: "place", label: "Lieu", width: 18 }, { key: "workStop", label: "Arrêt de travail", width: 9 }, { key: "stopStart", label: "Début arrêt", type: "date", width: 12 },
          { key: "stopEnd", label: "Fin arrêt", type: "date", width: 12 }, { key: "cnps", label: "Déclaration CNPS", width: 16 }, { key: "cnpsRef", label: "Réf. CNPS", width: 14 }, { key: "qualification", label: "Qualification", width: 12 }, { key: "status", label: "Statut", width: 10 }, { key: "gaps", label: "Éléments manquants", width: 30 },
        ],
        rows: rows.map((r) => ({
          number: r.number, date: r.occurredOn, time: r.occurredTime, employee: r.employeeName, matricule: r.employeeNumber, department: r.departmentName, kind: label(ACCIDENT_KINDS, r.kind), place: r.place, workStop: r.workStop,
          stopStart: r.stopStart, stopEnd: r.stopEnd, cnps: label(CNPS_STATUSES, r.cnpsStatus), cnpsRef: r.cnpsReference, qualification: label(QUALIFICATIONS, r.qualification), status: label(ACCIDENT_STATUSES, r.status), gaps: r.gaps.map((g) => g.message).join(" ; "),
        })),
      };
    },
  },
  "hr-permissions": {
    module: "hr", permissions: [],
    async build(ctx, q) {
      const { rows } = await listTimeOffs(ctx, { status: oneOf(q("statut"), ["DRAFT", "PENDING", "APPROVED", "REJECTED", "CANCELLED"]), typeId: q("type"), q: q("q"), skip: 0, take: MAX_ROWS });
      return {
        ...base(ctx), title: "Registre des permissions",
        columns: [
          { key: "employee", label: "Salarié", width: 22 }, { key: "matricule", label: "Matricule", width: 11 }, { key: "type", label: "Type", width: 18 }, { key: "unit", label: "Nature", width: 10 }, { key: "start", label: "Début", width: 16 }, { key: "end", label: "Fin", width: 16 },
          { key: "days", label: "Jours", type: "number", width: 7 }, { key: "hours", label: "Heures", type: "number", width: 7 }, { key: "paid", label: "Rémunérée", width: 9 }, { key: "reason", label: "Motif", width: 28 }, { key: "status", label: "Statut", width: 11 },
        ],
        rows: rows.map((r) => ({
          employee: `${r.employee.lastName} ${r.employee.firstName}`, matricule: r.employee.number, type: r.type.name, unit: r.unit === "DAILY" ? "Journalière" : "Horaire",
          start: `${iso(r.startDate)}${r.startTime ? ` ${r.startTime}` : ""}`, end: `${iso(r.endDate)}${r.endTime ? ` ${r.endTime}` : ""}`,
          days: Number(r.days), hours: Number(r.hours), paid: r.paid, reason: r.reason, status: REQUEST_STATUS[r.status] ?? r.status,
        })),
      };
    },
  },
  "hr-absences": {
    module: "hr", permissions: [],
    async build(ctx, q) {
      const { rows } = await listAbsences(ctx, { status: oneOf(q("statut"), ["PENDING", "APPROVED", "REJECTED", "CANCELLED"]), typeId: q("motif"), category: oneOf(q("categorie"), ["JUSTIFIED", "UNJUSTIFIED", "SICK", "EXCEPTIONAL", "OTHER"]), justification: oneOf(q("justificatif"), ["NOT_REQUIRED", "PENDING", "PROVIDED", "ACCEPTED", "REFUSED"]), q: q("q"), skip: 0, take: MAX_ROWS });
      return {
        ...base(ctx), title: "Registre des absences",
        columns: [
          { key: "employee", label: "Salarié", width: 22 }, { key: "matricule", label: "Matricule", width: 11 }, { key: "type", label: "Motif", width: 20 }, { key: "category", label: "Catégorie", width: 13 }, { key: "start", label: "Du", type: "date", width: 12 }, { key: "end", label: "Au", type: "date", width: 12 },
          { key: "days", label: "Jours", type: "number", width: 7 }, { key: "justification", label: "Justificatif", width: 16 }, { key: "status", label: "Statut", width: 11 }, { key: "reason", label: "Observation", width: 28 },
        ],
        rows: rows.map((r) => ({
          employee: `${r.employee.lastName} ${r.employee.firstName}`, matricule: r.employee.number, type: r.type.name, category: label(ABSENCE_CATEGORIES, r.type.category), start: r.startDate, end: r.endDate,
          days: Number(r.days), justification: label(JUSTIFICATIONS, r.justification), status: REQUEST_STATUS[r.status] ?? r.status, reason: r.reason,
        })),
      };
    },
  },
  "hr-arrets-maladie": {
    module: "hr", permissions: ["hr.sickleave.read"],
    async build(ctx, q) {
      const { rows } = await listSickLeaves(ctx, { status: oneOf(q("statut"), ["ONGOING", "ENDED", "CANCELLED"]), q: q("q"), skip: 0, take: MAX_ROWS });
      return {
        ...base(ctx), title: "Suivi des arrêts maladie", subtitle: "Suivi administratif : aucune donnée médicale",
        columns: [
          { key: "employee", label: "Salarié", width: 22 }, { key: "matricule", label: "Matricule", width: 11 }, { key: "start", label: "Début", type: "date", width: 12 }, { key: "end", label: "Fin prévue", type: "date", width: 12 },
          { key: "return", label: "Reprise effective", type: "date", width: 14 }, { key: "days", label: "Jours", type: "number", width: 7 }, { key: "ext", label: "Prolongations", type: "number", width: 12 },
          { key: "certificate", label: "Justificatif", width: 14 }, { key: "status", label: "Statut", width: 10 }, { key: "alerts", label: "Alertes", width: 34 },
        ],
        rows: rows.map((r) => ({ employee: `${r.employee.lastName} ${r.employee.firstName}`, matricule: r.employee.number, start: r.startDate, end: r.expectedEndDate, return: r.returnDate, days: r.days, ext: r._count.extensions, certificate: label(CERTIFICATE_STATUSES, r.certificate), status: label(SICK_STATUSES, r.status), alerts: r.alerts.map((a) => a.message).join(" ; ") })),
      };
    },
  },
  "hr-registre-personnel": {
    module: "hr", permissions: ["hr.employee.read"],
    async build(ctx, q) {
      const { rows } = await staffRegister(ctx, { q: q("q"), status: oneOf(q("statut"), ["ACTIVE", "SUSPENDED", "TERMINATED"]), skip: 0, take: MAX_ROWS });
      return {
        ...base(ctx), title: "Registre du personnel", subtitle: "Document de gestion interne : ne remplace pas le registre légal de l'employeur",
        columns: [
          { key: "matricule", label: "Matricule", width: 11 }, { key: "name", label: "Nom et prénoms", width: 24 }, { key: "birth", label: "Naissance", type: "date", width: 12 }, { key: "phone", label: "Téléphone", width: 14 }, { key: "email", label: "E-mail", width: 24 },
          { key: "address", label: "Adresse", width: 26 }, { key: "department", label: "Service", width: 16 }, { key: "branch", label: "Agence", width: 14 }, { key: "job", label: "Poste", width: 18 }, { key: "category", label: "Statut professionnel", width: 16 },
          { key: "contract", label: "Contrat", width: 10 }, { key: "hire", label: "Embauche", type: "date", width: 12 }, { key: "manager", label: "Responsable", width: 20 }, { key: "status", label: "Situation", width: 11 }, { key: "exit", label: "Sortie", type: "date", width: 12 }, { key: "reason", label: "Motif de sortie", width: 22 },
        ],
        rows: rows.map((r) => ({
          matricule: r.number, name: `${r.lastName} ${r.firstName}`, birth: r.birthDate, phone: r.phone, email: r.email, address: [r.address, r.city].filter(Boolean).join(", "), department: r.department?.name, branch: r.branch?.name, job: r.jobTitle, category: r.professionalCategory,
          contract: r.contract ? CONTRACT_TYPES.find((t) => t.value === r.contract!.type)?.label : "", hire: r.hireDate, manager: r.manager ? `${r.manager.lastName} ${r.manager.firstName}` : "", status: r.status === "ACTIVE" ? "En activité" : r.status === "SUSPENDED" ? "Suspendu" : "Sorti", exit: r.endDate, reason: r.terminationReason,
        })),
      };
    },
  },
  "hr-retards": {
    module: "hr", permissions: [],
    async build(ctx, q) {
      const { rows } = await listLateness(ctx, { justification: oneOf(q("justificatif"), ["PENDING", "PROVIDED", "ACCEPTED", "REFUSED"]), from: dateParam(q("du")), to: dateParam(q("au")), q: q("q"), skip: 0, take: MAX_ROWS });
      return {
        ...base(ctx), title: "Registre des retards",
        columns: [
          { key: "date", label: "Date", type: "date", width: 12 }, { key: "employee", label: "Salarié", width: 22 }, { key: "matricule", label: "Matricule", width: 11 }, { key: "expected", label: "Heure prévue", width: 10 }, { key: "actual", label: "Arrivée", width: 9 },
          { key: "minutes", label: "Retard (min)", type: "number", width: 10 }, { key: "justification", label: "Justification", width: 16 }, { key: "reason", label: "Motif", width: 26 }, { key: "hrNote", label: "Observation RH", width: 26 },
        ],
        rows: rows.map((r) => ({ date: r.date, employee: `${r.employee.lastName} ${r.employee.firstName}`, matricule: r.employee.number, expected: r.expectedTime, actual: r.actualTime, minutes: r.minutesLate, justification: label(JUSTIFICATIONS, r.justification), reason: r.reason, hrNote: r.hrNote })),
      };
    },
  },
};

Object.assign(HR_EXPORTERS, HR_ADMIN_EXPORTERS);
