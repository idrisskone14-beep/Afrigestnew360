import { z } from "zod";
import { COUNTRIES } from "@/lib/reference-data";

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const email = z.string().trim().email("E-mail invalide").optional().or(z.literal(""));
const money = z.coerce.number().min(0, "Montant positif requis").max(1e13);

export const customerSchema = z.object({
  type: z.enum(["COMPANY", "INDIVIDUAL"]),
  name: z.string().trim().min(2, "Nom requis").max(150),
  email,
  phone: text(40),
  address: text(250),
  city: text(100),
  country: z.string().refine((c) => c === "" || COUNTRIES.some((x) => x.code === c), "Pays invalide").optional(),
  taxId: text(60),
  rccm: text(60),
  website: text(200),
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
  creditLimit: z.union([z.literal(""), money]).optional(),
  notes: text(2000),
});
export type CustomerInput = z.input<typeof customerSchema>;

export const updateCustomerSchema = customerSchema.extend({ id: uuid, isActive: z.boolean().default(true) });

export const contactSchema = z.object({
  customerId: uuid,
  name: z.string().trim().min(2, "Nom requis").max(100),
  title: text(100),
  email,
  phone: text(40),
  isPrimary: z.boolean().default(false),
});
export const updateContactSchema = contactSchema.omit({ customerId: true }).extend({ id: uuid });
export const idSchema = z.object({ id: uuid });

export const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "LOST"] as const;
export const leadSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(100),
  companyName: text(150),
  email,
  phone: text(40),
  source: text(60),
  estimatedValue: z.union([z.literal(""), money]).optional(),
  notes: text(2000),
});
export const updateLeadSchema = leadSchema.extend({ id: uuid, status: z.enum(LEAD_STATUSES) });
export const convertLeadSchema = z.object({
  id: uuid,
  createOpportunity: z.boolean().default(false),
  opportunityTitle: text(150),
});

export const stageSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(60),
  probability: z.coerce.number().int().min(0).max(100),
  kind: z.enum(["OPEN", "WON", "LOST"]),
});
export const updateStageSchema = stageSchema.extend({ id: uuid });
export const moveStageSchema = z.object({ id: uuid, direction: z.enum(["up", "down"]) });

export const opportunitySchema = z.object({
  title: z.string().trim().min(2, "Titre requis").max(150),
  customerId: uuid.optional().or(z.literal("")),
  leadId: uuid.optional().or(z.literal("")),
  stageId: uuid,
  amount: money,
  expectedCloseDate: z.string().optional().or(z.literal("")),
  notes: text(2000),
});
export const updateOpportunitySchema = opportunitySchema.extend({ id: uuid });
export const moveOpportunitySchema = z.object({ id: uuid, stageId: uuid, lostReason: text(300) });

export const ACTIVITY_TYPES = [
  { value: "CALL", label: "Appel" }, { value: "MEETING", label: "Rendez-vous" }, { value: "EMAIL", label: "E-mail" },
  { value: "NOTE", label: "Note" }, { value: "TASK", label: "Tâche / relance" },
] as const;
export const activitySchema = z.object({
  type: z.enum(["CALL", "MEETING", "EMAIL", "NOTE", "TASK"]),
  subject: z.string().trim().min(2, "Objet requis").max(200),
  notes: text(2000),
  dueAt: z.string().optional().or(z.literal("")),
  customerId: uuid.optional().or(z.literal("")),
  leadId: uuid.optional().or(z.literal("")),
  opportunityId: uuid.optional().or(z.literal("")),
});
export const completeActivitySchema = z.object({ id: uuid, done: z.boolean() });
