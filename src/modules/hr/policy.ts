import "server-only";
import { z } from "zod";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { businessRule } from "@/core/errors";
import type { TenantContext } from "@/core/tenant/context";
import { DEFAULT_SCHEDULE, TIME_RE, toMinutes, workWindows, type Schedule } from "./time";

type Ctx = TenantContext;

/**
 * Paramètres RH de l'entreprise : horaire de référence, tolérance de retard, seuils de détection, délai de déclaration des accidents.
 * Aucune valeur réglementaire n'est présumée : ce sont des réglages de l'entreprise, à fixer avec son conseil juridique.
 */
export interface HrPolicy {
  schedule: Schedule;
  lateGraceMinutes: number;
  lateRecurrenceCount: number;
  lateRecurrenceDays: number;
  absenceRepeatCount: number;
  absenceRepeatDays: number;
  /** null : aucune alerte de délai. */
  accidentDeclarationDays: number | null;
  /** Alerte de reprise : un arrêt maladie se termine dans au plus N jours (ou est dépassé sans reprise). */
  sickReturnAlertDays: number;
  /** Rappels : visites médicales à venir et remplacement d'équipement (jours). */
  visitReminderDays: number;
  equipmentAlertDays: number;
}

export const DEFAULT_POLICY: HrPolicy = {
  schedule: DEFAULT_SCHEDULE, lateGraceMinutes: 0, lateRecurrenceCount: 3, lateRecurrenceDays: 30, absenceRepeatCount: 3, absenceRepeatDays: 90, accidentDeclarationDays: null, sickReturnAlertDays: 3, visitReminderDays: 30, equipmentAlertDays: 30,
};

export async function loadPolicy(db: Pick<Db, "hrSettings">): Promise<HrPolicy> {
  const s = await db.hrSettings.findFirst();
  if (!s) return DEFAULT_POLICY;
  return {
    schedule: { start: s.workStartTime, end: s.workEndTime, breakStart: s.breakStartTime, breakEnd: s.breakEndTime },
    lateGraceMinutes: s.lateGraceMinutes, lateRecurrenceCount: s.lateRecurrenceCount, lateRecurrenceDays: s.lateRecurrenceDays,
    absenceRepeatCount: s.absenceRepeatCount, absenceRepeatDays: s.absenceRepeatDays, accidentDeclarationDays: s.accidentDeclarationDays, sickReturnAlertDays: s.sickReturnAlertDays, visitReminderDays: s.visitReminderDays, equipmentAlertDays: s.equipmentAlertDays,
  };
}

const time = z.string().regex(TIME_RE, "Heure au format HH:MM");
const optTime = z.union([z.literal(""), time]).optional();
const optInt = (min: number, max: number) => z.union([z.literal(""), z.coerce.number().int().min(min).max(max)]).nullable().optional();

export const hrPolicySchema = z.object({
  workStartTime: time,
  workEndTime: time,
  breakStartTime: optTime,
  breakEndTime: optTime,
  lateGraceMinutes: z.coerce.number().int().min(0, "0 minimum").max(240),
  lateRecurrenceCount: z.coerce.number().int().min(1).max(50),
  lateRecurrenceDays: z.coerce.number().int().min(1).max(365),
  absenceRepeatCount: z.coerce.number().int().min(1).max(50),
  absenceRepeatDays: z.coerce.number().int().min(1).max(365),
  accidentDeclarationDays: optInt(1, 365),
  sickReturnAlertDays: z.coerce.number().int().min(0).max(60).default(3),
  visitReminderDays: z.coerce.number().int().min(0).max(365).default(30),
  equipmentAlertDays: z.coerce.number().int().min(0).max(365).default(30),
});

export async function savePolicy(ctx: Ctx, input: z.output<typeof hrPolicySchema>) {
  const breakStart = input.breakStartTime || null, breakEnd = input.breakEndTime || null;
  if (Boolean(breakStart) !== Boolean(breakEnd)) throw businessRule("Renseignez le début ET la fin de la pause, ou aucun des deux.");
  if (toMinutes(input.workEndTime) <= toMinutes(input.workStartTime)) throw businessRule("La fin de journée doit suivre le début de journée.");
  workWindows({ start: input.workStartTime, end: input.workEndTime, breakStart, breakEnd }); // la pause doit tenir dans la journée
  if (breakStart && breakEnd && !(toMinutes(breakStart) > toMinutes(input.workStartTime) && toMinutes(breakEnd) > toMinutes(breakStart) && toMinutes(breakEnd) < toMinutes(input.workEndTime))) {
    throw businessRule("La pause doit commencer après le début et finir avant la fin de la journée.");
  }
  const accidentDeclarationDays = input.accidentDeclarationDays === "" || input.accidentDeclarationDays == null ? null : input.accidentDeclarationDays;
  const data = {
    workStartTime: input.workStartTime, workEndTime: input.workEndTime, breakStartTime: breakStart, breakEndTime: breakEnd, lateGraceMinutes: input.lateGraceMinutes,
    lateRecurrenceCount: input.lateRecurrenceCount, lateRecurrenceDays: input.lateRecurrenceDays, absenceRepeatCount: input.absenceRepeatCount, absenceRepeatDays: input.absenceRepeatDays, accidentDeclarationDays, sickReturnAlertDays: input.sickReturnAlertDays, visitReminderDays: input.visitReminderDays, equipmentAlertDays: input.equipmentAlertDays,
  };
  const before = await loadPolicy(ctx.db);
  await ctx.db.hrSettings.upsert({ where: { companyId: ctx.company.id }, create: { companyId: ctx.company.id, ...data }, update: data });
  await audit(ctx, { action: "hr.policy.update", resource: "HrSettings", summary: `${ctx.user.name} a modifié les paramètres RH (horaires, tolérance, seuils).`, before, after: data });
}

/** Forme plate des paramètres pour le formulaire (champs du schéma de saisie). */
export const policyForm = (p: HrPolicy) => ({
  workStartTime: p.schedule.start, workEndTime: p.schedule.end, breakStartTime: p.schedule.breakStart, breakEndTime: p.schedule.breakEnd, lateGraceMinutes: p.lateGraceMinutes,
  lateRecurrenceCount: p.lateRecurrenceCount, lateRecurrenceDays: p.lateRecurrenceDays, absenceRepeatCount: p.absenceRepeatCount, absenceRepeatDays: p.absenceRepeatDays, accidentDeclarationDays: p.accidentDeclarationDays, sickReturnAlertDays: p.sickReturnAlertDays, visitReminderDays: p.visitReminderDays, equipmentAlertDays: p.equipmentAlertDays,
});
