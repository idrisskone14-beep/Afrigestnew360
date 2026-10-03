import { z } from "zod";

const uuid = z.string().uuid();
const emptyOr = <T extends z.ZodType>(s: T) => z.union([z.literal(""), s]);
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const code = z.string().trim().max(20).regex(/^[A-Za-z0-9._-]*$/, "Lettres, chiffres, point, tiret ou souligné").optional().or(z.literal(""));

export const idSchema = z.object({ id: uuid });

export const branchSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(120),
  code,
  address: text(250),
  city: text(100),
  isHeadquarters: z.boolean().default(false),
});
export const updateBranchSchema = branchSchema.extend({ id: uuid, isActive: z.boolean().default(true) });

export const siteSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(120),
  type: text(60),
  address: text(250),
  branchId: emptyOr(uuid).optional(),
});
export const updateSiteSchema = siteSchema.extend({ id: uuid, isActive: z.boolean().default(true) });

export const departmentSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(120),
  code,
  parentId: emptyOr(uuid).optional(),
});
export const updateDepartmentSchema = departmentSchema.extend({ id: uuid, isActive: z.boolean().default(true) });

export const costCenterSchema = z.object({
  code: z.string().trim().min(1, "Code requis").max(20).regex(/^[A-Za-z0-9._-]+$/, "Lettres, chiffres, point, tiret ou souligné"),
  name: z.string().trim().min(2, "Nom requis").max(120),
});
export const updateCostCenterSchema = costCenterSchema.extend({ id: uuid, isActive: z.boolean().default(true) });
