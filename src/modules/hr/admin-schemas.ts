import { z } from "zod";
import { TIME_RE } from "./time";

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const reqText = (min: number, max: number, msg: string) => z.string().trim().min(min, msg).max(max);
const dateStr = z.string().min(10, "Date requise");
const optDate = z.string().optional().or(z.literal(""));
const time = z.string().regex(TIME_RE, "Heure au format HH:MM");
const optUuid = z.union([z.literal(""), uuid]).optional();
export const idSchema = z.object({ id: uuid });

// ── Heures supplémentaires ─────────────────────────────────────

export const overtimeRateSchema = z.object({
  name: reqText(2, 80, "Nom requis"),
  multiplier: z.coerce.number().gt(0, "Coefficient positif").max(10),
  description: text(200),
});
export const updateOvertimeRateSchema = overtimeRateSchema.extend({ id: uuid, isActive: z.boolean().default(true) });

export const overtimeSchema = z.object({
  employeeId: uuid,
  date: dateStr,
  startTime: time,
  endTime: time,
  rateId: optUuid,
  reason: reqText(3, 500, "Indiquez le motif"),
  submit: z.boolean().default(false),
});
export const updateOvertimeSchema = overtimeSchema.omit({ employeeId: true, submit: true }).extend({ id: uuid });

// ── Avances et acomptes ────────────────────────────────────────

export const ADVANCE_KINDS = [{ value: "ADVANCE", label: "Avance sur salaire" }, { value: "ACOMPTE", label: "Acompte" }] as const;
export const advanceSchema = z.object({
  employeeId: uuid,
  kind: z.enum(["ADVANCE", "ACOMPTE"]),
  amount: z.coerce.number().gt(0, "Montant positif").max(1e12),
  requestDate: dateStr,
  reason: text(300),
  installments: z.coerce.number().int().min(1, "Au moins une mensualité").max(60),
  /** Premier mois de retenue (n'importe quel jour du mois). */
  firstDeductionMonth: dateStr,
  submit: z.boolean().default(false),
});
export const updateAdvanceSchema = advanceSchema.omit({ employeeId: true, submit: true }).extend({ id: uuid });
export const repaymentSchema = z.object({ advanceId: uuid, date: dateStr, amount: z.coerce.number().gt(0, "Montant positif").max(1e12), note: text(200) });

// ── Sanctions disciplinaires ───────────────────────────────────

export const DISCIPLINE_STATUSES = [
  { value: "OPEN", label: "Procédure en cours" }, { value: "DECIDED", label: "Sanction décidée" }, { value: "NOTIFIED", label: "Notifiée" }, { value: "CLOSED", label: "Classé sans suite" }, { value: "CANCELLED", label: "Annulé" },
] as const;
export const STEP_KINDS = [
  { value: "FACTS_REPORT", label: "Constat des faits" }, { value: "EXPLANATION_REQUEST", label: "Demande d'explications" }, { value: "CONVOCATION", label: "Convocation" }, { value: "HEARING", label: "Audition / entretien" },
  { value: "DECISION", label: "Décision" }, { value: "NOTIFICATION", label: "Notification" }, { value: "OTHER", label: "Autre étape" },
] as const;

export const sanctionTypeSchema = z.object({ name: reqText(2, 100, "Nom requis"), requiresHearing: z.boolean().default(true), description: text(300) });
export const updateSanctionTypeSchema = sanctionTypeSchema.extend({ id: uuid, isActive: z.boolean().default(true) });

const caseFields = {
  factsDate: dateStr,
  description: reqText(5, 3000, "Décrivez les faits"),
  breachNature: reqText(2, 200, "Nature du manquement requise"),
  procedureNote: text(1500),
  responsibleName: text(120),
  observations: text(1500),
};
export const disciplinaryCaseSchema = z.object({ employeeId: uuid, ...caseFields });
export const updateDisciplinaryCaseSchema = z.object({ id: uuid, ...caseFields });
export const stepSchema = z.object({ caseId: uuid, kind: z.enum(["FACTS_REPORT", "EXPLANATION_REQUEST", "CONVOCATION", "HEARING", "DECISION", "NOTIFICATION", "OTHER"]), date: dateStr, note: text(500) });
/** Décision : la sanction retenue (type configuré) et sa date. */
export const decideCaseSchema = z.object({ id: uuid, sanctionTypeId: uuid, decisionDate: dateStr, note: text(500) });
export const notifyCaseSchema = z.object({ id: uuid, notificationDate: dateStr });
export const closeCaseSchema = z.object({ id: uuid, note: text(500) });

// ── Visites médicales ──────────────────────────────────────────

export const VISIT_KINDS = [{ value: "HIRING", label: "Embauche" }, { value: "PERIODIC", label: "Périodique" }, { value: "RETURN", label: "Reprise" }, { value: "OTHER", label: "Autre visite réglementaire" }] as const;
export const VISIT_STATUSES = [{ value: "PLANNED", label: "Programmée" }, { value: "DONE", label: "Réalisée" }, { value: "CANCELLED", label: "Annulée" }] as const;
export const medicalVisitSchema = z.object({
  employeeId: uuid,
  kind: z.enum(["HIRING", "PERIODIC", "RETURN", "OTHER"]),
  scheduledOn: dateStr,
  provider: text(150),
  notes: text(300),
});
export const updateMedicalVisitSchema = medicalVisitSchema.omit({ employeeId: true }).extend({ id: uuid });
export const completeVisitSchema = z.object({ id: uuid, doneOn: dateStr, nextDueOn: optDate, aptitudeDoc: z.enum(["NOT_REQUIRED", "PENDING", "PROVIDED"]).default("PENDING") });

// ── Équipements et EPI ─────────────────────────────────────────

export const CONDITIONS = [{ value: "NEW", label: "Neuf" }, { value: "GOOD", label: "Bon état" }, { value: "WORN", label: "Usé" }, { value: "DAMAGED", label: "Endommagé" }] as const;
export const equipmentSchema = z.object({
  employeeId: uuid,
  name: reqText(2, 150, "Équipement requis"),
  reference: text(100),
  quantity: z.coerce.number().int().min(1, "Au moins 1").max(10000),
  issuedOn: dateStr,
  condition: z.enum(["NEW", "GOOD", "WORN", "DAMAGED"]),
  replaceOn: optDate,
  responsibleName: text(120),
  observations: text(500),
  /** Liaison facultative au stock (module Stock actif) : une sortie de stock est enregistrée à la remise. */
  productId: optUuid,
  warehouseId: optUuid,
});
export const returnEquipmentSchema = z.object({ id: uuid, returnedOn: dateStr, returnCondition: z.enum(["NEW", "GOOD", "WORN", "DAMAGED"]), backToStock: z.boolean().default(false) });
