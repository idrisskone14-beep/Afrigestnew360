import { z } from "zod";
import { TIME_RE } from "./time";

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const reqText = (min: number, max: number, msg: string) => z.string().trim().min(min, msg).max(max);
const dateStr = z.string().min(10, "Date requise");
const optDate = z.string().optional().or(z.literal(""));
const time = z.string().regex(TIME_RE, "Heure au format HH:MM");
const optTime = z.union([z.literal(""), time]).optional();

export const idSchema = z.object({ id: uuid });

// ── Accidents de travail ───────────────────────────────────────

export const ACCIDENT_KINDS = [
  { value: "WORKPLACE", label: "Accident de travail" },
  { value: "COMMUTE", label: "Accident de trajet" },
  { value: "MISSION", label: "Accident en mission" },
] as const;
export const ACCIDENT_STATUSES = [{ value: "OPEN", label: "Ouvert" }, { value: "CLOSED", label: "Clos" }, { value: "ARCHIVED", label: "Archivé" }] as const;
export const CNPS_STATUSES = [
  { value: "TO_DECLARE", label: "À déclarer" }, { value: "DECLARED", label: "Déclaré" }, { value: "ACKNOWLEDGED", label: "Accusé de réception" }, { value: "NOT_REQUIRED", label: "Sans objet" },
] as const;
export const QUALIFICATIONS = [{ value: "TO_QUALIFY", label: "À qualifier" }, { value: "RECOGNIZED", label: "Reconnu" }, { value: "NOT_RECOGNIZED", label: "Non reconnu" }] as const;

const accidentFields = {
  kind: z.enum(["WORKPLACE", "COMMUTE", "MISSION"]),
  occurredOn: dateStr,
  occurredTime: optTime,
  place: reqText(2, 200, "Lieu requis"),
  category: text(120),
  circumstances: reqText(5, 3000, "Décrivez les circonstances"),
  injuries: text(1500),
  witnesses: text(1000),
  firstAid: text(1000),
  careFacility: text(200),
  commuteDetails: text(1500),
  workStop: z.boolean().default(false),
  stopStart: optDate,
  stopEnd: optDate,
  returnDate: optDate,
  cnpsStatus: z.enum(["NOT_REQUIRED", "TO_DECLARE", "DECLARED", "ACKNOWLEDGED"]).default("TO_DECLARE"),
  cnpsDeclaredOn: optDate,
  cnpsReference: text(100),
  qualification: z.enum(["TO_QUALIFY", "RECOGNIZED", "NOT_RECOGNIZED"]).default("TO_QUALIFY"),
  correctiveActions: text(2000),
};
export const accidentSchema = z.object({ employeeId: uuid, ...accidentFields });
export const updateAccidentSchema = z.object({ id: uuid, ...accidentFields });

// ── Permissions ────────────────────────────────────────────────

export const TIMEOFF_UNITS = [{ value: "DAILY", label: "Journalière" }, { value: "HOURLY", label: "Horaire" }] as const;
export const timeOffTypeSchema = z.object({
  name: reqText(2, 100, "Nom requis"),
  paid: z.boolean().default(true),
  requiresProof: z.boolean().default(false),
  maxDays: z.union([z.literal(""), z.coerce.number().min(0.5).max(365)]).nullable().optional(),
});
export const updateTimeOffTypeSchema = timeOffTypeSchema.extend({ id: uuid, isActive: z.boolean().default(true) });

export const timeOffSchema = z.object({
  employeeId: uuid,
  typeId: uuid,
  unit: z.enum(["HOURLY", "DAILY"]),
  startDate: dateStr,
  startTime: optTime,
  endDate: dateStr,
  endTime: optTime,
  reason: reqText(3, 500, "Indiquez le motif"),
  comment: text(500),
  /** Rémunérée ou non ; par défaut, le réglage du type de permission. */
  paid: z.boolean().optional(),
  /** Soumettre immédiatement à validation (sinon : brouillon). */
  submit: z.boolean().default(false),
});
export const updateTimeOffSchema = timeOffSchema.omit({ employeeId: true, submit: true }).extend({ id: uuid });

// ── Absences ───────────────────────────────────────────────────

export const ABSENCE_CATEGORIES = [
  { value: "JUSTIFIED", label: "Justifiée" }, { value: "UNJUSTIFIED", label: "Injustifiée" }, { value: "SICK", label: "Maladie" }, { value: "EXCEPTIONAL", label: "Exceptionnelle" }, { value: "OTHER", label: "Autre motif" },
] as const;
export const JUSTIFICATIONS = [
  { value: "NOT_REQUIRED", label: "Sans justificatif" }, { value: "PENDING", label: "À justifier" }, { value: "PROVIDED", label: "Justificatif fourni" }, { value: "ACCEPTED", label: "Justifiée" }, { value: "REFUSED", label: "Non justifiée" },
] as const;

export const absenceTypeSchema = z.object({
  name: reqText(2, 100, "Nom requis"),
  category: z.enum(["JUSTIFIED", "UNJUSTIFIED", "SICK", "EXCEPTIONAL", "OTHER"]),
  requiresValidation: z.boolean().default(false),
  requiresProof: z.boolean().default(false),
});
export const updateAbsenceTypeSchema = absenceTypeSchema.extend({ id: uuid, isActive: z.boolean().default(true) });

const absenceFields = {
  typeId: uuid,
  startDate: dateStr,
  endDate: dateStr,
  halfDay: z.boolean().default(false),
  reason: text(500),
};
export const absenceSchema = z.object({ employeeId: uuid, ...absenceFields });
export const updateAbsenceSchema = z.object({ id: uuid, ...absenceFields });
export const justifyAbsenceSchema = z.object({ id: uuid, justification: z.enum(["NOT_REQUIRED", "PENDING", "PROVIDED", "ACCEPTED", "REFUSED"]), hrNote: text(500) });

// ── Retards ────────────────────────────────────────────────────

export const latenessSchema = z.object({
  employeeId: uuid,
  date: dateStr,
  /** Heure prévue ; par défaut, l'heure de début de journée des paramètres RH. */
  expectedTime: optTime,
  actualTime: time,
  reason: text(500),
});
export const updateLatenessSchema = z.object({ id: uuid, expectedTime: optTime, actualTime: time, reason: text(500) });
export const justifyLatenessSchema = z.object({ id: uuid, justification: z.enum(["PENDING", "PROVIDED", "ACCEPTED", "REFUSED"]), hrNote: text(500) });
export const importLatenessSchema = z.object({ from: dateStr, to: dateStr });

// ── Arrêts maladie (suivi administratif) ───────────────────────

export const SICK_STATUSES = [{ value: "ONGOING", label: "En cours" }, { value: "ENDED", label: "Terminé" }, { value: "CANCELLED", label: "Annulé" }] as const;
export const CERTIFICATE_STATUSES = [{ value: "PENDING", label: "Attendu" }, { value: "PROVIDED", label: "Reçu" }, { value: "ACCEPTED", label: "Conforme" }, { value: "REFUSED", label: "Non conforme" }] as const;

const sickFields = {
  startDate: dateStr,
  expectedEndDate: dateStr,
  certificate: z.enum(["PENDING", "PROVIDED", "ACCEPTED", "REFUSED"]).default("PENDING"),
  /** Observations d'ordre administratif uniquement : aucun diagnostic ni donnée médicale. */
  observations: text(500),
};
export const sickLeaveSchema = z.object({ employeeId: uuid, ...sickFields });
export const updateSickLeaveSchema = z.object({ id: uuid, ...sickFields });
export const extendSickLeaveSchema = z.object({ id: uuid, newEnd: dateStr, note: text(300) });
export const returnSickLeaveSchema = z.object({ id: uuid, returnDate: dateStr });

// ── Registre du personnel ──────────────────────────────────────

export const assignmentSchema = z.object({
  employeeId: uuid,
  effectiveDate: dateStr,
  jobTitle: text(120),
  departmentId: z.union([z.literal(""), uuid]).optional(),
  branchId: z.union([z.literal(""), uuid]).optional(),
  managerId: z.union([z.literal(""), uuid]).optional(),
  professionalCategory: text(80),
  reason: text(300),
});
