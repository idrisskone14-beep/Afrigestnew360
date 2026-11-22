import "server-only";
import type { z } from "zod";
import { audit } from "@/core/audit";
import { businessRule, notFound } from "@/core/errors";
import type { TenantContext } from "@/core/tenant/context";
import { recordMovement } from "@/modules/inventory/stock";
import { loadPolicy } from "./policy";
import type { equipmentSchema, returnEquipmentSchema } from "./admin-schemas";
import { assertCan } from "./scope";
import { addDays, dayOf, parseDay } from "./time";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const fr = (v: Date) => v.toLocaleDateString("fr-FR", { timeZone: "UTC" });
const READ = "hr.equipment.read", MANAGE = "hr.equipment.manage";

/** Équipements et EPI remis aux salariés : historique des attributions, restitutions, alertes de remplacement, liaison facultative au stock. */
export async function listEquipment(ctx: Ctx, p: { status?: "OUT" | "RETURNED"; employeeId?: string; q?: string; skip: number; take: number }) {
  assertCan(ctx, READ);
  const where = {
    ...(p.status === "OUT" ? { returnedOn: null } : p.status === "RETURNED" ? { returnedOn: { not: null } } : {}),
    ...(p.employeeId ? { employeeId: p.employeeId } : {}),
    ...(p.q ? { OR: [{ name: { contains: p.q, mode: "insensitive" as const } }, { reference: { contains: p.q, mode: "insensitive" as const } }, { employee: { lastName: { contains: p.q, mode: "insensitive" as const } } }, { employee: { firstName: { contains: p.q, mode: "insensitive" as const } } }, { employee: { number: { contains: p.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [total, rows, policy] = await Promise.all([
    ctx.db.equipmentAssignment.count({ where }),
    ctx.db.equipmentAssignment.findMany({ where, orderBy: [{ issuedOn: "desc" }, { createdAt: "desc" }], skip: p.skip, take: p.take, include: { employee: { select: { id: true, firstName: true, lastName: true, number: true, status: true } } } }),
    loadPolicy(ctx.db),
  ]);
  const today = new Date();
  return { total, rows: rows.map((r) => ({ ...r, alert: equipmentAlert(r, r.employee.status, today, policy.equipmentAlertDays) })) };
}

export async function getEquipment(ctx: Ctx, id: string) {
  assertCan(ctx, READ);
  const r = await ctx.db.equipmentAssignment.findFirst({ where: { id }, include: { employee: { select: { id: true, firstName: true, lastName: true, number: true, departmentId: true } } } });
  if (!r) throw notFound("Équipement");
  return r;
}

export type EquipmentAlert = "replace_overdue" | "replace_soon" | "not_returned" | null;
/** Alerte (fonction pure) : remplacement dépassé ou proche, ou équipement non restitué par un salarié sorti. */
export function equipmentAlert(e: { returnedOn: Date | null; replaceOn: Date | null }, employeeStatus: string, today: Date, alertDays: number): EquipmentAlert {
  if (e.returnedOn) return null;
  if (employeeStatus === "TERMINATED") return "not_returned";
  if (!e.replaceOn) return null;
  const t = dayOf(today);
  if (e.replaceOn < t) return "replace_overdue";
  return e.replaceOn <= addDays(t, alertDays) ? "replace_soon" : null;
}

export async function equipmentAlerts(ctx: Ctx, today = new Date()) {
  assertCan(ctx, READ);
  const policy = await loadPolicy(ctx.db);
  const rows = await ctx.db.equipmentAssignment.findMany({ where: { returnedOn: null }, include: { employee: { select: { id: true, firstName: true, lastName: true, number: true, status: true } } }, orderBy: { replaceOn: "asc" } });
  return rows.map((r) => ({ ...r, alert: equipmentAlert(r, r.employee.status, today, policy.equipmentAlertDays) })).filter((r) => r.alert);
}

/**
 * Remise d'un équipement. Si un produit et un entrepôt sont indiqués (module Stock actif), une SORTIE de stock est enregistrée dans la même
 * transaction : tout ou rien. Elle se rétablit à la restitution (retour en stock) ; aucune écriture irréversible.
 */
export async function issueEquipment(ctx: Ctx, input: z.output<typeof equipmentSchema>) {
  assertCan(ctx, MANAGE);
  const emp = await ctx.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null } });
  if (!emp) throw notFound("Salarié");
  if (emp.status === "TERMINATED") throw businessRule("Ce salarié est sorti des effectifs.");
  const issued = parseDay(input.issuedOn);
  if (!issued) throw businessRule("Date de remise invalide.");
  if (issued > dayOf(new Date())) throw businessRule("La date de remise ne peut pas être dans le futur.");
  if (issued < emp.hireDate) throw businessRule("La remise précède l'embauche.");
  const replace = input.replaceOn ? parseDay(input.replaceOn) : null;
  if (input.replaceOn && !replace) throw businessRule("Date de remplacement invalide.");
  if (replace && replace <= issued) throw businessRule("Le remplacement doit être prévu après la remise.");
  const productId = input.productId || null, warehouseId = input.warehouseId || null;
  if (Boolean(productId) !== Boolean(warehouseId)) throw businessRule("Pour sortir du stock, indiquez le produit ET l'entrepôt.");
  if (productId && (!ctx.hasModule("inventory") || !ctx.can("inventory.movement.read"))) throw businessRule("La liaison au stock exige le module Stock et ses droits.");
  const row = await ctx.tx(async (tx) => {
    const mv = productId ? await recordMovement(tx, ctx, { productId, warehouseId: warehouseId!, type: "OUT", delta: -input.quantity, skipCost: true, sourceType: "hr_equipment", reason: `Remise à ${emp.firstName} ${emp.lastName} (${emp.number})`, date: issued }) : null;
    const e = await tx.equipmentAssignment.create({
      data: { companyId: ctx.company.id, employeeId: emp.id, name: input.name.trim(), reference: blank(input.reference), quantity: input.quantity, issuedOn: issued, condition: input.condition, replaceOn: replace, responsibleName: blank(input.responsibleName) ?? ctx.user.name, observations: blank(input.observations), productId, warehouseId, issueMovementId: mv?.id ?? null, createdById: ctx.user.id },
    });
    await audit(ctx, { action: "hr.equipment.issue", resource: "EquipmentAssignment", resourceId: e.id, summary: `${ctx.user.name} a remis ${e.quantity} × « ${e.name} » à ${emp.firstName} ${emp.lastName} le ${fr(issued)}${mv ? " (sortie de stock enregistrée)" : ""}.` }, tx);
    return e;
  });
  return row;
}

export async function returnEquipment(ctx: Ctx, input: z.output<typeof returnEquipmentSchema>) {
  assertCan(ctx, MANAGE);
  const e = await ctx.db.equipmentAssignment.findFirst({ where: { id: input.id }, include: { employee: { select: { firstName: true, lastName: true } } } });
  if (!e) throw notFound("Équipement");
  if (e.returnedOn) throw businessRule("Cet équipement est déjà restitué.");
  const date = parseDay(input.returnedOn);
  if (!date) throw businessRule("Date de restitution invalide.");
  if (date > dayOf(new Date())) throw businessRule("La date de restitution ne peut pas être dans le futur.");
  if (date < e.issuedOn) throw businessRule("La restitution précède la remise.");
  if (input.backToStock && !(e.productId && e.warehouseId && e.issueMovementId)) throw businessRule("Cet équipement n'a pas été sorti du stock : rien à remettre en stock.");
  await ctx.tx(async (tx) => {
    const mv = input.backToStock ? await recordMovement(tx, ctx, { productId: e.productId!, warehouseId: e.warehouseId!, type: "RETURN", delta: e.quantity, skipCost: true, sourceType: "hr_equipment", sourceId: e.id, reason: `Restitution par ${e.employee.firstName} ${e.employee.lastName}`, date }) : null;
    await tx.equipmentAssignment.update({ where: { id: e.id }, data: { returnedOn: date, returnCondition: input.returnCondition, returnMovementId: mv?.id ?? null } });
  });
  await audit(ctx, { action: "hr.equipment.return", resource: "EquipmentAssignment", resourceId: e.id, summary: `${ctx.user.name} a enregistré la restitution de « ${e.name} » par ${e.employee.firstName} ${e.employee.lastName} (${fr(date)})${input.backToStock ? ", remis en stock" : ""}.` });
}

/** Correction d'informations d'une attribution non restituée (la quantité ne change plus si une sortie de stock est liée). */
export async function updateEquipment(ctx: Ctx, input: { id: string; name: string; reference?: string; replaceOn?: string; responsibleName?: string; observations?: string; condition: "NEW" | "GOOD" | "WORN" | "DAMAGED" }) {
  assertCan(ctx, MANAGE);
  const e = await ctx.db.equipmentAssignment.findFirst({ where: { id: input.id } });
  if (!e) throw notFound("Équipement");
  if (e.returnedOn) throw businessRule("Cet équipement est restitué : l'attribution n'est plus modifiable.");
  const replace = input.replaceOn ? parseDay(input.replaceOn) : null;
  if (input.replaceOn && !replace) throw businessRule("Date de remplacement invalide.");
  if (replace && replace <= e.issuedOn) throw businessRule("Le remplacement doit être prévu après la remise.");
  await ctx.db.equipmentAssignment.update({ where: { id: e.id }, data: { name: input.name.trim(), reference: blank(input.reference), replaceOn: replace, responsibleName: blank(input.responsibleName), observations: blank(input.observations), condition: input.condition } });
  await audit(ctx, { action: "hr.equipment.update", resource: "EquipmentAssignment", resourceId: e.id, summary: `${ctx.user.name} a modifié l'attribution de « ${e.name} ».` });
}
