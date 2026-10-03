"use server";

import { revalidatePath } from "next/cache";
import { defineTenantAction } from "@/core/actions/define";
import * as emp from "./employees";
import * as lv from "./leave";
import * as pp from "./people";
import {
  attendanceSchema, bulkAttendanceSchema, contractSchema, employeeSchema, evaluationSchema, idSchema, leaveRequestSchema, leaveTypeSchema, terminateSchema, trainingSchema,
  updateEmployeeSchema, updateLeaveTypeSchema,
} from "./schemas";

const bust = () => { revalidatePath("/app/hr", "layout"); revalidatePath("/app/validations"); revalidatePath("/app/payroll", "layout"); };
const M = "hr";

// Salariés et contrats
export const createEmployeeAction = defineTenantAction({ input: employeeSchema, module: M, permission: "hr.employee.create", handler: async ({ ctx, input }) => { const e = await emp.createEmployee(ctx, input); bust(); return { id: e.id }; } });
export const updateEmployeeAction = defineTenantAction({ input: updateEmployeeSchema, module: M, permission: "hr.employee.update", handler: async ({ ctx, input }) => { await emp.updateEmployee(ctx, input); bust(); } });
export const terminateEmployeeAction = defineTenantAction({ input: terminateSchema, module: M, permission: "hr.employee.update", handler: async ({ ctx, input }) => { await emp.terminateEmployee(ctx, input); bust(); } });
export const addContractAction = defineTenantAction({ input: contractSchema, module: M, permission: "hr.contract.manage", handler: async ({ ctx, input }) => { const c = await emp.addContract(ctx, input); bust(); return { id: c.id }; } });

// Congés
export const createLeaveTypeAction = defineTenantAction({ input: leaveTypeSchema, module: M, permission: "hr.employee.update", handler: async ({ ctx, input }) => { await lv.createLeaveType(ctx, input); bust(); } });
export const updateLeaveTypeAction = defineTenantAction({ input: updateLeaveTypeSchema, module: M, permission: "hr.employee.update", handler: async ({ ctx, input }) => { await lv.updateLeaveType(ctx, input); bust(); } });
// La demande est ouverte à qui détient « demander un congé » (pour soi) ou « modifier les salariés » (RH) : le service tranche selon le salarié visé.
export const requestLeaveAction = defineTenantAction({ input: leaveRequestSchema, module: M, handler: async ({ ctx, input }) => {
  if (!ctx.can("hr.leave.request") && !ctx.can("hr.employee.update")) ctx.assertCan("hr.leave.request");
  const r = await lv.requestLeave(ctx, input); bust(); return { id: r.id, autoApproved: r.autoApproved };
} });
export const cancelLeaveAction = defineTenantAction({ input: idSchema, module: M, permission: "hr.leave.read", handler: async ({ ctx, input }) => { await lv.cancelLeave(ctx, input.id); bust(); } });

// Présences, évaluations, formations
export const setAttendanceAction = defineTenantAction({ input: attendanceSchema, module: M, permission: "hr.attendance.manage", handler: async ({ ctx, input }) => { await pp.setAttendance(ctx, input); bust(); } });
export const markAllPresentAction = defineTenantAction({ input: bulkAttendanceSchema, module: M, permission: "hr.attendance.manage", handler: async ({ ctx, input }) => { const r = await pp.markAllPresent(ctx, input); bust(); return r; } });
export const createEvaluationAction = defineTenantAction({ input: evaluationSchema, module: M, permission: "hr.evaluation.manage", handler: async ({ ctx, input }) => { await pp.createEvaluation(ctx, input); bust(); } });
export const deleteEvaluationAction = defineTenantAction({ input: idSchema, module: M, permission: "hr.evaluation.manage", handler: async ({ ctx, input }) => { await pp.deleteEvaluation(ctx, input.id); bust(); } });
export const createTrainingAction = defineTenantAction({ input: trainingSchema, module: M, permission: "hr.evaluation.manage", handler: async ({ ctx, input }) => { await pp.createTraining(ctx, input); bust(); } });
export const deleteTrainingAction = defineTenantAction({ input: idSchema, module: M, permission: "hr.evaluation.manage", handler: async ({ ctx, input }) => { await pp.deleteTraining(ctx, input.id); bust(); } });
