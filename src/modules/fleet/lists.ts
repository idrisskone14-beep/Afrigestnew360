import "server-only";
import type { TenantContext } from "@/core/tenant/context";

type Ctx = TenantContext;
export interface Opt { id: string; name: string }

/** Listes de choix des formulaires de la flotte (uniquement ce que le module peut légitimement proposer). */
export async function fleetOptions(ctx: Ctx) {
  const [vehicles, drivers, branches, costCenters, employees, customers, projects, suppliers] = await Promise.all([
    ctx.db.vehicle.findMany({ where: { deletedAt: null, status: { not: "SOLD" } }, orderBy: { plate: "asc" }, select: { id: true, plate: true, status: true } }),
    ctx.db.driver.findMany({ where: { deletedAt: null, status: "ACTIVE" }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    ctx.db.branch.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.db.costCenter.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    ctx.hasModule("hr") && ctx.can("hr.employee.read") ? ctx.db.employee.findMany({ where: { deletedAt: null, status: "ACTIVE" }, orderBy: { lastName: "asc" }, select: { id: true, firstName: true, lastName: true } }) : Promise.resolve([]),
    ctx.hasModule("crm") && ctx.can("crm.customer.read") ? ctx.db.customer.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } }) : Promise.resolve([]),
    ctx.hasModule("projects") && ctx.can("project.project.read") ? ctx.db.project.findMany({ where: { deletedAt: null, status: { in: ["PLANNED", "ACTIVE"] } }, orderBy: { name: "asc" }, take: 500, select: { id: true, code: true, name: true } }) : Promise.resolve([]),
    ctx.hasModule("purchases") && ctx.can("purchases.supplier.read") ? ctx.db.supplier.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  return {
    vehicles: vehicles.filter((v) => v.status === "ACTIVE" || v.status === "IN_MAINTENANCE").map((v) => ({ id: v.id, name: v.plate })),
    allVehicles: vehicles.map((v) => ({ id: v.id, name: v.plate })),
    drivers: drivers.map((x) => ({ id: x.id, name: x.fullName })),
    branches, costCenters: costCenters.map((c) => ({ id: c.id, name: `${c.code} — ${c.name}` })),
    employees: employees.map((e) => ({ id: e.id, name: `${e.lastName} ${e.firstName}` })),
    customers, projects: projects.map((p) => ({ id: p.id, name: `${p.code} — ${p.name}` })), suppliers,
  };
}
