import { z } from "zod";

const uuid = z.string().uuid();
const emptyOr = <T extends z.ZodType>(s: T) => z.union([z.literal(""), s]);
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const optDate = z.string().optional().or(z.literal(""));
const dateStr = z.string().min(8, "Date requise");
const money = z.coerce.number().min(0).max(1e13);

export const idSchema = z.object({ id: uuid });
export const PROJECT_STATUSES = [
  { value: "PLANNED", label: "Planifié" }, { value: "ACTIVE", label: "En cours" }, { value: "ON_HOLD", label: "En pause" }, { value: "DONE", label: "Terminé" }, { value: "CANCELLED", label: "Annulé" },
] as const;
export const TASK_STATUSES = [{ value: "TODO", label: "À faire" }, { value: "IN_PROGRESS", label: "En cours" }, { value: "REVIEW", label: "En revue" }, { value: "DONE", label: "Terminé" }] as const;
export const PRIORITIES = [{ value: "LOW", label: "Basse" }, { value: "MEDIUM", label: "Normale" }, { value: "HIGH", label: "Haute" }, { value: "URGENT", label: "Urgente" }] as const;

export const projectSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(150),
  description: text(2000),
  customerId: emptyOr(uuid).optional(),
  managerId: emptyOr(uuid).optional(),
  status: z.enum(["PLANNED", "ACTIVE", "ON_HOLD", "DONE", "CANCELLED"]).default("PLANNED"),
  startDate: optDate,
  endDate: optDate,
  budget: money.default(0),
  billRate: money.default(0),
  branchId: emptyOr(uuid).optional(),
  costCenterId: emptyOr(uuid).optional(),
});
export type ProjectInput = z.input<typeof projectSchema>;
export const updateProjectSchema = projectSchema.extend({ id: uuid });
export const projectStatusSchema = z.object({ id: uuid, status: z.enum(["PLANNED", "ACTIVE", "ON_HOLD", "DONE", "CANCELLED"]) });

export const taskSchema = z.object({
  projectId: uuid,
  title: z.string().trim().min(2, "Titre requis").max(200),
  description: text(3000),
  status: z.enum(["TODO", "IN_PROGRESS", "REVIEW", "DONE"]).default("TODO"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  assigneeId: emptyOr(uuid).optional(),
  startDate: optDate,
  dueDate: optDate,
  estimateHours: z.coerce.number().min(0).max(100000).default(0),
  dependsOnId: emptyOr(uuid).optional(),
});
export const updateTaskSchema = taskSchema.omit({ projectId: true }).extend({ id: uuid });
export const moveTaskSchema = z.object({ id: uuid, status: z.enum(["TODO", "IN_PROGRESS", "REVIEW", "DONE"]) });

export const timeSchema = z.object({
  projectId: uuid,
  taskId: emptyOr(uuid).optional(),
  employeeId: uuid,
  date: dateStr,
  hours: z.coerce.number().positive("Durée > 0").max(24, "24 h maximum par saisie"),
  billable: z.boolean().default(true),
  description: text(300),
});
export const updateTimeSchema = timeSchema.omit({ projectId: true, employeeId: true }).extend({ id: uuid });
export const invoiceTimeSchema = z.object({ projectId: uuid, entryIds: z.array(uuid).max(500).optional() });
