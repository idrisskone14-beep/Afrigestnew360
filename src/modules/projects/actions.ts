"use server";

import { revalidatePath } from "next/cache";
import { defineTenantAction } from "@/core/actions/define";
import { idSchema, invoiceTimeSchema, moveTaskSchema, projectSchema, projectStatusSchema, taskSchema, timeSchema, updateProjectSchema, updateTaskSchema, updateTimeSchema } from "./schemas";
import * as svc from "./service";

const bust = () => { revalidatePath("/app/projects", "layout"); revalidatePath("/app/sales", "layout"); };
const M = "projects";

export const createProjectAction = defineTenantAction({ input: projectSchema, module: M, permission: "project.project.create", handler: async ({ ctx, input }) => { const p = await svc.createProject(ctx, input); bust(); return { id: p.id }; } });
export const updateProjectAction = defineTenantAction({ input: updateProjectSchema, module: M, permission: "project.project.update", handler: async ({ ctx, input }) => { await svc.updateProject(ctx, input); bust(); } });
export const setProjectStatusAction = defineTenantAction({ input: projectStatusSchema, module: M, permission: "project.project.update", handler: async ({ ctx, input }) => { await svc.setProjectStatus(ctx, input.id, input.status); bust(); } });

export const createTaskAction = defineTenantAction({ input: taskSchema, module: M, permission: "project.project.update", handler: async ({ ctx, input }) => { const t = await svc.createTask(ctx, input); bust(); return { id: t.id }; } });
export const updateTaskAction = defineTenantAction({ input: updateTaskSchema, module: M, permission: "project.project.update", handler: async ({ ctx, input }) => { await svc.updateTask(ctx, input); bust(); } });
// Déplacement : tout titulaire du droit « tâches » ; le service limite aux tâches qui lui sont confiées s'il ne gère pas le projet
export const moveTaskAction = defineTenantAction({ input: moveTaskSchema, module: M, permission: "project.task.manage", handler: async ({ ctx, input }) => { await svc.moveTask(ctx, input); bust(); } });
export const deleteTaskAction = defineTenantAction({ input: idSchema, module: M, permission: "project.project.update", handler: async ({ ctx, input }) => { await svc.deleteTask(ctx, input.id); bust(); } });

export const logTimeAction = defineTenantAction({ input: timeSchema, module: M, handler: async ({ ctx, input }) => {
  if (!ctx.can("project.task.manage") && !ctx.can("project.time.manage")) ctx.assertCan("project.task.manage");
  const t = await svc.logTime(ctx, input); bust(); return { id: t.id };
} });
export const updateTimeAction = defineTenantAction({ input: updateTimeSchema, module: M, handler: async ({ ctx, input }) => {
  if (!ctx.can("project.task.manage") && !ctx.can("project.time.manage")) ctx.assertCan("project.task.manage");
  await svc.updateTime(ctx, input); bust();
} });
export const deleteTimeAction = defineTenantAction({ input: idSchema, module: M, handler: async ({ ctx, input }) => {
  if (!ctx.can("project.task.manage") && !ctx.can("project.time.manage")) ctx.assertCan("project.task.manage");
  await svc.deleteTime(ctx, input.id); bust();
} });
export const invoiceTimeAction = defineTenantAction({ input: invoiceTimeSchema, module: M, permission: ["project.project.update", "finance.invoice.create"], handler: async ({ ctx, input }) => { const i = await svc.invoiceTime(ctx, input); bust(); return { id: i.id }; } });
