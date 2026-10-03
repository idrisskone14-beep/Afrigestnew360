import { z } from "zod";

const uuid = z.string().uuid();
const emptyOr = <T extends z.ZodType>(s: T) => z.union([z.literal(""), s]);
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const dateStr = z.string().min(8, "Date requise");
const optDate = z.string().optional().or(z.literal(""));
const money = z.coerce.number().min(0, "Montant positif").max(1e13);

export const idSchema = z.object({ id: uuid });

export const CONTRACT_TYPES = [
  { value: "PERMANENT", label: "CDI" }, { value: "FIXED_TERM", label: "CDD" }, { value: "TEMP", label: "Intérim" }, { value: "INTERNSHIP", label: "Stage" }, { value: "CONSULTANT", label: "Prestataire" },
] as const;
export const PAYOUT_METHODS = [{ value: "BANK_TRANSFER", label: "Virement" }, { value: "CASH", label: "Espèces" }, { value: "MOBILE_MONEY", label: "Mobile money" }] as const;
export const ATTENDANCE_STATUSES = [
  { value: "PRESENT", label: "Présent" }, { value: "ABSENT", label: "Absent" }, { value: "LATE", label: "En retard" }, { value: "REMOTE", label: "Télétravail" }, { value: "HALF_DAY", label: "Demi-journée" },
] as const;

export const employeeSchema = z.object({
  firstName: z.string().trim().min(1, "Prénom requis").max(80),
  lastName: z.string().trim().min(1, "Nom requis").max(80),
  email: z.string().trim().email("E-mail invalide").optional().or(z.literal("")),
  phone: text(40),
  birthDate: optDate,
  nationalId: text(60),
  address: text(250),
  city: text(100),
  hireDate: dateStr,
  jobTitle: text(120),
  departmentId: emptyOr(uuid).optional(),
  branchId: emptyOr(uuid).optional(),
  managerId: emptyOr(uuid).optional(),
  userId: emptyOr(uuid).optional(),
  baseSalary: money.default(0),
  payoutMethod: z.enum(["BANK_TRANSFER", "CASH", "MOBILE_MONEY"]).default("BANK_TRANSFER"),
  payoutReference: text(80),
});
export type EmployeeInput = z.input<typeof employeeSchema>;
export const updateEmployeeSchema = employeeSchema.extend({ id: uuid });
export const terminateSchema = z.object({ id: uuid, endDate: dateStr, reason: text(300) });

export const contractSchema = z.object({
  employeeId: uuid,
  type: z.enum(["PERMANENT", "FIXED_TERM", "TEMP", "INTERNSHIP", "CONSULTANT"]),
  startDate: dateStr,
  endDate: optDate,
  jobTitle: text(120),
  salary: money,
  notes: text(500),
});

export const leaveTypeSchema = z.object({ name: z.string().trim().min(2, "Nom requis").max(80), annualDays: z.coerce.number().min(0).max(366).default(0), paid: z.boolean().default(true) });
export const updateLeaveTypeSchema = leaveTypeSchema.extend({ id: uuid, isActive: z.boolean().default(true) });
export const leaveRequestSchema = z.object({ employeeId: uuid, typeId: uuid, startDate: dateStr, endDate: dateStr, reason: text(500) });

export const attendanceSchema = z.object({
  employeeId: uuid,
  date: dateStr,
  status: z.enum(["PRESENT", "ABSENT", "LATE", "REMOTE", "HALF_DAY"]),
  checkIn: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure HH:MM").optional().or(z.literal("")),
  checkOut: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure HH:MM").optional().or(z.literal("")),
  notes: text(300),
});
export const bulkAttendanceSchema = z.object({ date: dateStr });

export const evaluationSchema = z.object({
  employeeId: uuid,
  period: z.string().trim().min(2, "Période requise").max(40),
  date: dateStr,
  score: z.coerce.number().int().min(1, "Note de 1 à 5").max(5, "Note de 1 à 5"),
  objectives: text(1500),
  comments: text(1500),
});
export const trainingSchema = z.object({
  employeeId: uuid,
  title: z.string().trim().min(2, "Intitulé requis").max(150),
  provider: text(120),
  date: dateStr,
  hours: z.coerce.number().min(0).max(1000).default(0),
  cost: money.default(0),
  notes: text(500),
});
