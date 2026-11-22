"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineTenantAction } from "@/core/actions/define";
import * as ab from "./absences";
import * as ac from "./accidents";
import * as adv from "./advances";
import * as ad from "./admin-schemas";
import * as eq from "./equipment";
import * as la from "./lateness";
import * as mv from "./medvisits";
import * as ot from "./overtime";
import * as sa from "./sanctions";
import * as sk from "./sickleave";
import * as st from "./staff";
import { hrPolicySchema, savePolicy } from "./policy";
import {
  absenceSchema, absenceTypeSchema, accidentSchema, assignmentSchema, extendSickLeaveSchema, idSchema, returnSickLeaveSchema, sickLeaveSchema, updateSickLeaveSchema, importLatenessSchema, justifyAbsenceSchema, justifyLatenessSchema, latenessSchema, timeOffSchema, timeOffTypeSchema,
  updateAbsenceSchema, updateAbsenceTypeSchema, updateAccidentSchema, updateLatenessSchema, updateTimeOffSchema, updateTimeOffTypeSchema,
} from "./registers-schemas";
import * as to from "./timeoff";

const bust = () => { revalidatePath("/app/hr", "layout"); revalidatePath("/app/validations"); };
const M = "hr";

// Paramètres RH (horaires, tolérance, seuils)
export const saveHrPolicyAction = defineTenantAction({ input: hrPolicySchema, module: M, permission: "hr.holiday.manage", handler: async ({ ctx, input }) => { await savePolicy(ctx, input); bust(); } });

// Accidents de travail
export const createAccidentAction = defineTenantAction({ input: accidentSchema, module: M, permission: "hr.accident.manage", handler: async ({ ctx, input }) => { const a = await ac.createAccident(ctx, input); bust(); return { id: a.id, number: a.number }; } });
export const updateAccidentAction = defineTenantAction({ input: updateAccidentSchema, module: M, permission: "hr.accident.manage", handler: async ({ ctx, input }) => { await ac.updateAccident(ctx, input); bust(); } });
export const closeAccidentAction = defineTenantAction({ input: idSchema, module: M, permission: "hr.accident.manage", handler: async ({ ctx, input }) => { await ac.closeAccident(ctx, input.id); bust(); } });
export const reopenAccidentAction = defineTenantAction({ input: idSchema, module: M, permission: "hr.accident.manage", handler: async ({ ctx, input }) => { await ac.reopenAccident(ctx, input.id); bust(); } });
export const archiveAccidentAction = defineTenantAction({ input: idSchema.extend({ archived: z.boolean() }), module: M, permission: "hr.accident.manage", handler: async ({ ctx, input }) => { await ac.archiveAccident(ctx, input.id, input.archived); bust(); } });

// Permissions
export const createTimeOffTypeAction = defineTenantAction({ input: timeOffTypeSchema, module: M, permission: "hr.timeoff.manage", handler: async ({ ctx, input }) => { await to.createTimeOffType(ctx, input); bust(); } });
export const updateTimeOffTypeAction = defineTenantAction({ input: updateTimeOffTypeSchema, module: M, permission: "hr.timeoff.manage", handler: async ({ ctx, input }) => { await to.updateTimeOffType(ctx, input); bust(); } });
export const createTimeOffAction = defineTenantAction({ input: timeOffSchema, module: M, handler: async ({ ctx, input }) => { const r = await to.createTimeOff(ctx, input); bust(); return { id: r.id, status: r.status, autoApproved: r.autoApproved }; } });
export const updateTimeOffAction = defineTenantAction({ input: updateTimeOffSchema, module: M, handler: async ({ ctx, input }) => { await to.updateTimeOff(ctx, input); bust(); } });
export const submitTimeOffAction = defineTenantAction({ input: idSchema, module: M, handler: async ({ ctx, input }) => { const r = await to.submitTimeOff(ctx, input.id); bust(); return { autoApproved: r.autoApproved }; } });
export const cancelTimeOffAction = defineTenantAction({ input: idSchema, module: M, handler: async ({ ctx, input }) => { await to.cancelTimeOff(ctx, input.id); bust(); } });

// Absences
export const createAbsenceTypeAction = defineTenantAction({ input: absenceTypeSchema, module: M, permission: "hr.absence.manage", handler: async ({ ctx, input }) => { await ab.createAbsenceType(ctx, input); bust(); } });
export const updateAbsenceTypeAction = defineTenantAction({ input: updateAbsenceTypeSchema, module: M, permission: "hr.absence.manage", handler: async ({ ctx, input }) => { await ab.updateAbsenceType(ctx, input); bust(); } });
export const createAbsenceAction = defineTenantAction({ input: absenceSchema, module: M, permission: "hr.absence.manage", handler: async ({ ctx, input }) => { const r = await ab.createAbsence(ctx, input); bust(); return { id: r.id, status: r.status }; } });
export const updateAbsenceAction = defineTenantAction({ input: updateAbsenceSchema, module: M, permission: "hr.absence.manage", handler: async ({ ctx, input }) => { await ab.updateAbsence(ctx, input); bust(); } });
export const justifyAbsenceAction = defineTenantAction({ input: justifyAbsenceSchema, module: M, permission: "hr.absence.manage", handler: async ({ ctx, input }) => { await ab.justifyAbsence(ctx, input); bust(); } });
export const cancelAbsenceAction = defineTenantAction({ input: idSchema, module: M, handler: async ({ ctx, input }) => { await ab.cancelAbsence(ctx, input.id); bust(); } });

// Retards
export const createLatenessAction = defineTenantAction({ input: latenessSchema, module: M, permission: "hr.lateness.manage", handler: async ({ ctx, input }) => { const r = await la.createLateness(ctx, input); bust(); return { id: r.id, minutes: r.minutesLate }; } });
export const updateLatenessAction = defineTenantAction({ input: updateLatenessSchema, module: M, permission: "hr.lateness.manage", handler: async ({ ctx, input }) => { await la.updateLateness(ctx, input); bust(); } });
export const justifyLatenessAction = defineTenantAction({ input: justifyLatenessSchema, module: M, permission: "hr.lateness.manage", handler: async ({ ctx, input }) => { await la.justifyLateness(ctx, input); bust(); } });
export const deleteLatenessAction = defineTenantAction({ input: idSchema, module: M, permission: "hr.lateness.manage", handler: async ({ ctx, input }) => { await la.deleteLateness(ctx, input.id); bust(); } });
export const importLatenessAction = defineTenantAction({ input: importLatenessSchema, module: M, permission: "hr.lateness.manage", handler: async ({ ctx, input }) => { const r = await la.importLatenessFromAttendance(ctx, input); bust(); return r; } });

// Arrêts maladie (suivi administratif)
export const createSickLeaveAction = defineTenantAction({ input: sickLeaveSchema, module: M, permission: "hr.sickleave.manage", handler: async ({ ctx, input }) => { const r = await sk.createSickLeave(ctx, input); bust(); return { id: r.id }; } });
export const updateSickLeaveAction = defineTenantAction({ input: updateSickLeaveSchema, module: M, permission: "hr.sickleave.manage", handler: async ({ ctx, input }) => { await sk.updateSickLeave(ctx, input); bust(); } });
export const extendSickLeaveAction = defineTenantAction({ input: extendSickLeaveSchema, module: M, permission: "hr.sickleave.manage", handler: async ({ ctx, input }) => { await sk.extendSickLeave(ctx, input); bust(); } });
export const returnSickLeaveAction = defineTenantAction({ input: returnSickLeaveSchema, module: M, permission: "hr.sickleave.manage", handler: async ({ ctx, input }) => { await sk.recordReturn(ctx, input); bust(); } });
export const cancelSickLeaveAction = defineTenantAction({ input: idSchema, module: M, permission: "hr.sickleave.manage", handler: async ({ ctx, input }) => { await sk.cancelSickLeave(ctx, input.id); bust(); } });

// Registre du personnel : changement d'affectation daté
export const changeAssignmentAction = defineTenantAction({ input: assignmentSchema, module: M, permission: "hr.employee.update", handler: async ({ ctx, input }) => { await st.changeAssignment(ctx, input); bust(); } });

// ── Heures supplémentaires
export const createOvertimeRateAction = defineTenantAction({ input: ad.overtimeRateSchema, module: M, permission: "hr.overtime.manage", handler: async ({ ctx, input }) => { await ot.createOvertimeRate(ctx, input); bust(); } });
export const updateOvertimeRateAction = defineTenantAction({ input: ad.updateOvertimeRateSchema, module: M, permission: "hr.overtime.manage", handler: async ({ ctx, input }) => { await ot.updateOvertimeRate(ctx, input); bust(); } });
export const createOvertimeAction = defineTenantAction({ input: ad.overtimeSchema, module: M, handler: async ({ ctx, input }) => { const r = await ot.createOvertime(ctx, input); bust(); return { id: r.id, autoApproved: r.autoApproved }; } });
export const updateOvertimeAction = defineTenantAction({ input: ad.updateOvertimeSchema, module: M, handler: async ({ ctx, input }) => { await ot.updateOvertime(ctx, input); bust(); } });
export const submitOvertimeAction = defineTenantAction({ input: ad.idSchema, module: M, handler: async ({ ctx, input }) => { const r = await ot.submitOvertime(ctx, input.id); bust(); return { autoApproved: r.autoApproved }; } });
export const cancelOvertimeAction = defineTenantAction({ input: ad.idSchema, module: M, handler: async ({ ctx, input }) => { await ot.cancelOvertime(ctx, input.id); bust(); } });
export const assignOvertimeRateAction = defineTenantAction({ input: ad.idSchema.extend({ rateId: ad.idSchema.shape.id }), module: M, permission: "hr.overtime.manage", handler: async ({ ctx, input }) => { await ot.assignOvertimeRate(ctx, input); bust(); } });

// ── Avances et acomptes
export const createAdvanceAction = defineTenantAction({ input: ad.advanceSchema, module: M, handler: async ({ ctx, input }) => { const r = await adv.createAdvance(ctx, input); bust(); return { id: r.id, autoApproved: r.autoApproved }; } });
export const updateAdvanceAction = defineTenantAction({ input: ad.updateAdvanceSchema, module: M, handler: async ({ ctx, input }) => { await adv.updateAdvance(ctx, input); bust(); } });
export const submitAdvanceAction = defineTenantAction({ input: ad.idSchema, module: M, handler: async ({ ctx, input }) => { const r = await adv.submitAdvance(ctx, input.id); bust(); return { autoApproved: r.autoApproved }; } });
export const cancelAdvanceAction = defineTenantAction({ input: ad.idSchema, module: M, handler: async ({ ctx, input }) => { await adv.cancelAdvance(ctx, input.id); bust(); } });
export const recordRepaymentAction = defineTenantAction({ input: ad.repaymentSchema, module: M, permission: "hr.advance.manage", handler: async ({ ctx, input }) => { await adv.recordRepayment(ctx, input); bust(); } });

// ── Sanctions disciplinaires
export const createSanctionTypeAction = defineTenantAction({ input: ad.sanctionTypeSchema, module: M, permission: "hr.sanction.manage", handler: async ({ ctx, input }) => { await sa.createSanctionType(ctx, input); bust(); } });
export const updateSanctionTypeAction = defineTenantAction({ input: ad.updateSanctionTypeSchema, module: M, permission: "hr.sanction.manage", handler: async ({ ctx, input }) => { await sa.updateSanctionType(ctx, input); bust(); } });
export const createCaseAction = defineTenantAction({ input: ad.disciplinaryCaseSchema, module: M, permission: "hr.sanction.manage", handler: async ({ ctx, input }) => { const c = await sa.createCase(ctx, input); bust(); return { id: c.id }; } });
export const updateCaseAction = defineTenantAction({ input: ad.updateDisciplinaryCaseSchema, module: M, permission: "hr.sanction.manage", handler: async ({ ctx, input }) => { await sa.updateCase(ctx, input); bust(); } });
export const addStepAction = defineTenantAction({ input: ad.stepSchema, module: M, permission: "hr.sanction.manage", handler: async ({ ctx, input }) => { await sa.addStep(ctx, input); bust(); } });
export const decideCaseAction = defineTenantAction({ input: ad.decideCaseSchema, module: M, permission: "hr.sanction.manage", handler: async ({ ctx, input }) => { await sa.decideCase(ctx, input); bust(); } });
export const notifyCaseAction = defineTenantAction({ input: ad.notifyCaseSchema, module: M, permission: "hr.sanction.manage", handler: async ({ ctx, input }) => { await sa.notifyCase(ctx, input); bust(); } });
export const closeCaseAction = defineTenantAction({ input: ad.closeCaseSchema, module: M, permission: "hr.sanction.manage", handler: async ({ ctx, input }) => { await sa.closeCase(ctx, input); bust(); } });
export const cancelCaseAction = defineTenantAction({ input: ad.closeCaseSchema, module: M, permission: "hr.sanction.manage", handler: async ({ ctx, input }) => { await sa.cancelCase(ctx, input); bust(); } });

// ── Visites médicales
export const createVisitAction = defineTenantAction({ input: ad.medicalVisitSchema, module: M, permission: "hr.medvisit.manage", handler: async ({ ctx, input }) => { await mv.createVisit(ctx, input); bust(); } });
export const updateVisitAction = defineTenantAction({ input: ad.updateMedicalVisitSchema, module: M, permission: "hr.medvisit.manage", handler: async ({ ctx, input }) => { await mv.updateVisit(ctx, input); bust(); } });
export const completeVisitAction = defineTenantAction({ input: ad.completeVisitSchema, module: M, permission: "hr.medvisit.manage", handler: async ({ ctx, input }) => { await mv.completeVisit(ctx, input); bust(); } });
export const cancelVisitAction = defineTenantAction({ input: ad.idSchema, module: M, permission: "hr.medvisit.manage", handler: async ({ ctx, input }) => { await mv.cancelVisit(ctx, input.id); bust(); } });

// ── Équipements et EPI
export const issueEquipmentAction = defineTenantAction({ input: ad.equipmentSchema, module: M, permission: "hr.equipment.manage", handler: async ({ ctx, input }) => { const e = await eq.issueEquipment(ctx, input); bust(); return { id: e.id }; } });
export const returnEquipmentAction = defineTenantAction({ input: ad.returnEquipmentSchema, module: M, permission: "hr.equipment.manage", handler: async ({ ctx, input }) => { await eq.returnEquipment(ctx, input); bust(); } });
