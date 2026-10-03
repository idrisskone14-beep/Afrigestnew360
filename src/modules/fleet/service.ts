import "server-only";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { parseDate } from "@/core/documents/lines";
import { businessRule, conflict, notFound } from "@/core/errors";
import type { TenantContext } from "@/core/tenant/context";
import { assertOrgRefs } from "@/modules/org/service";
import type { z } from "zod";
import type { assignmentSchema, complianceSchema, driverSchema, updateDriverSchema, updateVehicleSchema, vehicleSchema } from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
export const DAY = 86_400_000;
export const todayUtc = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
/** Immatriculation normalisée : majuscules, sans espaces ni tirets superflus (« ci 1234 ab 01 » → « CI-1234-AB-01 »). */
export const normalizePlate = (p: string) => p.trim().toUpperCase().replace(/[\s_]+/g, "-").replace(/-{2,}/g, "-");

/** Types de véhicules routiers : ils exigent une assurance et une visite technique valides pour partir en mission. */
export const ROAD_TYPES = ["CAR", "VAN", "TRUCK", "MOTORCYCLE"] as const;

// ═══ Références ═══════════════════════════════════════════════

export async function assertVehicle(db: Pick<Db, "vehicle">, id: string, opts: { active?: boolean } = {}) {
  const v = await db.vehicle.findFirst({ where: { id, deletedAt: null } });
  if (!v) throw notFound("Véhicule");
  if (opts.active && v.status !== "ACTIVE") throw businessRule(`Le véhicule ${v.plate} n'est pas en service (${v.status === "SOLD" ? "vendu" : v.status === "IN_MAINTENANCE" ? "en maintenance" : "hors service"}).`);
  return v;
}

export async function assertDriver(db: Pick<Db, "driver">, id: string, opts: { active?: boolean } = {}) {
  const dr = await db.driver.findFirst({ where: { id, deletedAt: null } });
  if (!dr) throw notFound("Chauffeur");
  if (opts.active && dr.status !== "ACTIVE") throw businessRule(`Le chauffeur ${dr.fullName} n'est pas actif.`);
  return dr;
}

/**
 * Relevé kilométrique. Un relevé daté d'AUJOURD'HUI (ou plus récent que tous les autres) ne peut pas être inférieur au compteur du
 * véhicule et le fait avancer, sous verrou de ligne (deux saisies simultanées ne se marchent pas dessus). Un relevé ANTÉRIEUR (saisie
 * a posteriori) doit rester cohérent avec ses voisins dans le temps — jamais en dessous d'un relevé plus ancien, ni au-dessus d'un plus
 * récent — et ne modifie pas le compteur. Une correction à la baisse du compteur passe par la fiche du véhicule (tracée).
 */
export async function applyOdometer(tx: Db, vehicleId: string, km: number, at: Date = new Date()) {
  await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${vehicleId}::uuid FOR UPDATE`;
  const v = await tx.vehicle.findFirstOrThrow({ where: { id: vehicleId }, select: { odometer: true, plate: true } });
  const day = todayUtc(at);
  const [fuel, maint, trips] = await Promise.all([
    tx.fuelLog.findMany({ where: { vehicleId }, select: { date: true, odometer: true } }),
    tx.maintenanceRecord.findMany({ where: { vehicleId, status: "DONE", odometer: { not: null } }, select: { date: true, odometer: true } }),
    tx.trip.findMany({ where: { vehicleId, status: "DONE", endKm: { not: null } }, select: { endedAt: true, endKm: true } }),
  ]);
  const readings = [
    ...fuel.map((r) => ({ at: r.date, km: r.odometer })), ...maint.map((r) => ({ at: r.date, km: r.odometer! })), ...trips.map((r) => ({ at: todayUtc(r.endedAt ?? new Date()), km: r.endKm! })),
  ];
  const later = readings.filter((r) => r.at > day).map((r) => r.km);
  if (later.length === 0) {
    if (km < v.odometer) throw businessRule(`Kilométrage inférieur au dernier relevé de ${v.plate} (${v.odometer.toLocaleString("fr-FR")} km). Corrigez-le sur la fiche du véhicule si le compteur a été remplacé.`);
    if (km > v.odometer) await tx.vehicle.update({ where: { id: vehicleId }, data: { odometer: km } });
    return;
  }
  const earlier = readings.filter((r) => r.at <= day).map((r) => r.km);
  const lo = earlier.length ? Math.max(...earlier) : 0, hi = Math.min(...later);
  if (km < lo || km > hi) throw businessRule(`Kilométrage incohérent avec les autres relevés de ${v.plate} : à cette date il doit se situer entre ${lo.toLocaleString("fr-FR")} et ${hi.toLocaleString("fr-FR")} km.`);
}

// ═══ Véhicules ════════════════════════════════════════════════

export async function listVehicles(ctx: Ctx, p: { q?: string; status?: string; type?: string; skip: number; take: number }) {
  const where = {
    deletedAt: null,
    ...(p.status ? { status: p.status as never } : {}),
    ...(p.type ? { type: p.type as never } : {}),
    ...(p.q ? { OR: [{ plate: { contains: p.q.replace(/\s+/g, "-").toUpperCase() } }, { name: { contains: p.q, mode: "insensitive" as const } }, { brand: { contains: p.q, mode: "insensitive" as const } }, { model: { contains: p.q, mode: "insensitive" as const } }] } : {}),
  };
  const [total, rows] = await Promise.all([ctx.db.vehicle.count({ where }), ctx.db.vehicle.findMany({ where, orderBy: [{ status: "asc" }, { plate: "asc" }], skip: p.skip, take: p.take })]);
  return { total, rows };
}

export async function getVehicle(ctx: Ctx, id: string) {
  return assertVehicle(ctx.db, id);
}

export async function createVehicle(ctx: Ctx, input: z.output<typeof vehicleSchema>) {
  const plate = normalizePlate(input.plate);
  await assertOrgRefs(ctx.db, { branchId: input.branchId, costCenterId: input.costCenterId });
  if (await ctx.db.vehicle.findFirst({ where: { plate }, select: { id: true } })) throw conflict(`L'immatriculation ${plate} existe déjà.`);
  const v = await ctx.db.vehicle.create({
    data: {
      companyId: ctx.company.id, plate, name: blank(input.name), type: input.type as never, brand: blank(input.brand), model: blank(input.model), year: input.year === "" || input.year === undefined ? null : input.year, vin: blank(input.vin),
      fuelType: input.fuelType as never, odometer: input.odometer, acquisitionDate: parseDate(input.acquisitionDate), acquisitionCost: input.acquisitionCost.toString(), branchId: input.branchId || null, costCenterId: input.costCenterId || null, notes: blank(input.notes), createdById: ctx.user.id,
    },
  });
  await audit(ctx, { action: "fleet.vehicle.create", resource: "Vehicle", resourceId: v.id, summary: `${ctx.user.name} a ajouté le véhicule ${v.plate}.` });
  return v;
}

export async function updateVehicle(ctx: Ctx, input: z.output<typeof updateVehicleSchema>) {
  const before = await assertVehicle(ctx.db, input.id);
  const plate = normalizePlate(input.plate);
  await assertOrgRefs(ctx.db, { branchId: input.branchId, costCenterId: input.costCenterId });
  if (plate !== before.plate && (await ctx.db.vehicle.findFirst({ where: { plate, id: { not: input.id } }, select: { id: true } }))) throw conflict(`L'immatriculation ${plate} existe déjà.`);
  if (before.status === "SOLD" && input.status !== "SOLD") throw businessRule("Un véhicule vendu ne revient pas en service : créez une nouvelle fiche.");
  const v = await ctx.db.vehicle.update({
    where: { id: input.id },
    data: {
      plate, name: blank(input.name), type: input.type as never, brand: blank(input.brand), model: blank(input.model), year: input.year === "" || input.year === undefined ? null : input.year, vin: blank(input.vin), fuelType: input.fuelType as never,
      odometer: input.odometer, status: input.status as never, acquisitionDate: parseDate(input.acquisitionDate), acquisitionCost: input.acquisitionCost.toString(), branchId: input.branchId || null, costCenterId: input.costCenterId || null, notes: blank(input.notes),
    },
  });
  const odoNote = input.odometer !== before.odometer ? ` ; compteur corrigé de ${before.odometer} à ${input.odometer} km` : "";
  await audit(ctx, { action: "fleet.vehicle.update", resource: "Vehicle", resourceId: v.id, summary: `${ctx.user.name} a modifié le véhicule ${v.plate}${odoNote}.`, before: { status: before.status, odometer: before.odometer }, after: { status: v.status, odometer: v.odometer } });
  return v;
}

/** Retrait d'un véhicule de la flotte : refusé s'il a une mission en cours ou prévue. L'historique est conservé. */
export async function archiveVehicle(ctx: Ctx, id: string) {
  const v = await assertVehicle(ctx.db, id);
  if (await ctx.db.trip.findFirst({ where: { vehicleId: id, status: { in: ["PLANNED", "IN_PROGRESS"] } }, select: { id: true } })) throw businessRule("Ce véhicule a des missions planifiées ou en cours.");
  await ctx.db.vehicle.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(ctx, { action: "fleet.vehicle.archive", resource: "Vehicle", resourceId: id, summary: `${ctx.user.name} a retiré le véhicule ${v.plate} de la flotte.` });
}

// ═══ Chauffeurs ═══════════════════════════════════════════════

async function checkEmployee(ctx: Ctx, employeeId: string | undefined, selfId?: string) {
  if (!employeeId) return;
  if (!ctx.hasModule("hr")) throw businessRule("Le module Ressources humaines n'est pas activé : le chauffeur ne peut pas être lié à un salarié.");
  if (!(await ctx.db.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: { id: true } }))) throw notFound("Salarié");
  if (await ctx.db.driver.findFirst({ where: { employeeId, deletedAt: null, id: selfId ? { not: selfId } : undefined }, select: { id: true } })) throw conflict("Ce salarié est déjà enregistré comme chauffeur.");
}

export async function listDrivers(ctx: Ctx, p: { q?: string; status?: string; skip: number; take: number }) {
  const where = { deletedAt: null, ...(p.status ? { status: p.status as never } : {}), ...(p.q ? { fullName: { contains: p.q, mode: "insensitive" as const } } : {}) };
  const [total, rows] = await Promise.all([ctx.db.driver.count({ where }), ctx.db.driver.findMany({ where, orderBy: { fullName: "asc" }, skip: p.skip, take: p.take })]);
  return { total, rows };
}

export const getDriver = (ctx: Ctx, id: string) => assertDriver(ctx.db, id);

export async function createDriver(ctx: Ctx, input: z.output<typeof driverSchema>) {
  await checkEmployee(ctx, input.employeeId || undefined);
  const dr = await ctx.db.driver.create({
    data: { companyId: ctx.company.id, fullName: input.fullName.trim(), employeeId: input.employeeId || null, phone: blank(input.phone), licenseNumber: blank(input.licenseNumber), licenseCategory: blank(input.licenseCategory), licenseExpiry: parseDate(input.licenseExpiry), notes: blank(input.notes), createdById: ctx.user.id },
  });
  await audit(ctx, { action: "fleet.driver.create", resource: "Driver", resourceId: dr.id, summary: `${ctx.user.name} a ajouté le chauffeur ${dr.fullName}.` });
  return dr;
}

export async function updateDriver(ctx: Ctx, input: z.output<typeof updateDriverSchema>) {
  const before = await assertDriver(ctx.db, input.id);
  await checkEmployee(ctx, input.employeeId || undefined, input.id);
  const dr = await ctx.db.driver.update({
    where: { id: input.id },
    data: { fullName: input.fullName.trim(), employeeId: input.employeeId || null, phone: blank(input.phone), licenseNumber: blank(input.licenseNumber), licenseCategory: blank(input.licenseCategory), licenseExpiry: parseDate(input.licenseExpiry), status: input.status as never, notes: blank(input.notes) },
  });
  await audit(ctx, { action: "fleet.driver.update", resource: "Driver", resourceId: dr.id, summary: `${ctx.user.name} a modifié le chauffeur ${dr.fullName}.`, before: { status: before.status }, after: { status: dr.status } });
  return dr;
}

export async function archiveDriver(ctx: Ctx, id: string) {
  const dr = await assertDriver(ctx.db, id);
  if (await ctx.db.trip.findFirst({ where: { driverId: id, status: { in: ["PLANNED", "IN_PROGRESS"] } }, select: { id: true } })) throw businessRule("Ce chauffeur a des missions planifiées ou en cours.");
  await ctx.tx(async (tx) => {
    await tx.vehicleAssignment.updateMany({ where: { driverId: id, endDate: null }, data: { endDate: todayUtc() } });
    await tx.driver.update({ where: { id }, data: { deletedAt: new Date(), status: "LEFT" } });
  });
  await audit(ctx, { action: "fleet.driver.archive", resource: "Driver", resourceId: id, summary: `${ctx.user.name} a retiré le chauffeur ${dr.fullName}.` });
}

/** Le permis est-il valide à une date ? (sans date d'expiration renseignée : non vérifiable, donc accepté) */
export const licenseValid = (dr: { licenseExpiry: Date | null }, at: Date) => !dr.licenseExpiry || dr.licenseExpiry >= todayUtc(at);

// ═══ Affectations véhicule ↔ chauffeur ════════════════════════

/** Nouvelle affectation : clôt la précédente du véhicule la veille ; un chauffeur peut conduire plusieurs véhicules. */
export async function assignDriver(ctx: Ctx, input: z.output<typeof assignmentSchema>) {
  const v = await assertVehicle(ctx.db, input.vehicleId, { active: true });
  const dr = await assertDriver(ctx.db, input.driverId, { active: true });
  const start = parseDate(input.startDate)!;
  const a = await ctx.tx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${v.id}::uuid FOR UPDATE`;
    const open = await tx.vehicleAssignment.findMany({ where: { vehicleId: v.id, OR: [{ endDate: null }, { endDate: { gte: start } }] }, orderBy: { startDate: "desc" } });
    if (open.some((o) => o.startDate >= start)) throw businessRule("Une affectation existe déjà à partir de cette date : la nouvelle doit être la plus récente.");
    for (const o of open) await tx.vehicleAssignment.update({ where: { id: o.id }, data: { endDate: new Date(start.getTime() - DAY) } });
    return tx.vehicleAssignment.create({ data: { companyId: ctx.company.id, vehicleId: v.id, driverId: dr.id, startDate: start, note: blank(input.note) } });
  });
  await audit(ctx, { action: "fleet.assignment.create", resource: "VehicleAssignment", resourceId: a.id, summary: `${ctx.user.name} a affecté ${dr.fullName} au véhicule ${v.plate}.` });
  return a;
}

export async function endAssignment(ctx: Ctx, id: string) {
  const a = await ctx.db.vehicleAssignment.findFirst({ where: { id }, include: { vehicle: { select: { plate: true } }, driver: { select: { fullName: true } } } });
  if (!a) throw notFound("Affectation");
  if (a.endDate) throw businessRule("Cette affectation est déjà terminée.");
  await ctx.db.vehicleAssignment.update({ where: { id }, data: { endDate: todayUtc() } });
  await audit(ctx, { action: "fleet.assignment.end", resource: "VehicleAssignment", resourceId: id, summary: `${ctx.user.name} a mis fin à l'affectation de ${a.driver.fullName} au véhicule ${a.vehicle.plate}.` });
}

export const listAssignments = (ctx: Ctx, vehicleId: string) => ctx.db.vehicleAssignment.findMany({ where: { vehicleId }, orderBy: { startDate: "desc" }, include: { driver: { select: { id: true, fullName: true } } }, take: 50 });

/**
 * Chauffeur d'un véhicule à un instant donné : celui de la mission qui couvre cet instant, sinon l'affectation en cours à cette date.
 * Sert à pré-remplir le chauffeur d'une contravention.
 */
export async function driverAt(db: Pick<Db, "trip" | "vehicleAssignment">, vehicleId: string, at: Date): Promise<string | null> {
  const trip = await db.trip.findFirst({
    where: { vehicleId, status: { in: ["IN_PROGRESS", "DONE"] }, startedAt: { lte: at }, OR: [{ endedAt: { gte: at } }, { endedAt: null }] },
    orderBy: { startedAt: "desc" }, select: { driverId: true },
  });
  if (trip) return trip.driverId;
  const day = todayUtc(at);
  const a = await db.vehicleAssignment.findFirst({ where: { vehicleId, startDate: { lte: day }, OR: [{ endDate: null }, { endDate: { gte: day } }] }, orderBy: { startDate: "desc" }, select: { driverId: true } });
  return a?.driverId ?? null;
}

// ═══ Assurances, visites techniques, documents réglementaires ═

export type ComplianceState = "OK" | "EXPIRING" | "EXPIRED" | "MISSING";
/** Seul l'enregistrement le plus récent (échéance la plus lointaine) de chaque type compte : un renouvellement remplace l'ancien. */
export function complianceStatus(records: { kind: string; expiresAt: Date }[], kind: string, today = todayUtc(), warnDays = 30): { state: ComplianceState; expiresAt: Date | null } {
  const latest = records.filter((r) => r.kind === kind).sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())[0];
  if (!latest) return { state: "MISSING", expiresAt: null };
  if (latest.expiresAt < today) return { state: "EXPIRED", expiresAt: latest.expiresAt };
  return { state: latest.expiresAt.getTime() - today.getTime() <= warnDays * DAY ? "EXPIRING" : "OK", expiresAt: latest.expiresAt };
}

export const listCompliance = (ctx: Ctx, vehicleId: string) => ctx.db.vehicleCompliance.findMany({ where: { vehicleId }, orderBy: [{ expiresAt: "desc" }], take: 100 });

export async function addCompliance(ctx: Ctx, input: z.output<typeof complianceSchema>) {
  const v = await assertVehicle(ctx.db, input.vehicleId);
  const start = parseDate(input.startDate), end = parseDate(input.expiresAt)!;
  if (start && end < start) throw businessRule("L'échéance précède le début de validité.");
  const c = await ctx.db.vehicleCompliance.create({ data: { companyId: ctx.company.id, vehicleId: v.id, kind: input.kind as never, reference: blank(input.reference), provider: blank(input.provider), startDate: start, expiresAt: end, cost: input.cost.toString(), notes: blank(input.notes), createdById: ctx.user.id } });
  await audit(ctx, { action: "fleet.compliance.create", resource: "VehicleCompliance", resourceId: c.id, summary: `${ctx.user.name} a enregistré ${input.kind === "INSURANCE" ? "l'assurance" : input.kind === "TECHNICAL_INSPECTION" ? "la visite technique" : "un document réglementaire"} du véhicule ${v.plate} (échéance ${end.toISOString().slice(0, 10)}).` });
  return c;
}

export async function deleteCompliance(ctx: Ctx, id: string) {
  const c = await ctx.db.vehicleCompliance.findFirst({ where: { id }, include: { vehicle: { select: { plate: true } } } });
  if (!c) throw notFound("Document réglementaire");
  await ctx.db.vehicleCompliance.delete({ where: { id } });
  await audit(ctx, { action: "fleet.compliance.delete", resource: "VehicleCompliance", resourceId: id, summary: `${ctx.user.name} a supprimé un document réglementaire du véhicule ${c.vehicle.plate}.` });
}

/** Un véhicule routier peut-il partir en mission ? Assurance et visite technique, quand elles sont renseignées, doivent être valides. */
export async function assertRoadworthy(db: Pick<Db, "vehicleCompliance">, vehicle: { id: string; type: string; plate: string }, at: Date) {
  if (!(ROAD_TYPES as readonly string[]).includes(vehicle.type)) return;
  const records = await db.vehicleCompliance.findMany({ where: { vehicleId: vehicle.id, kind: { in: ["INSURANCE", "TECHNICAL_INSPECTION"] } }, select: { kind: true, expiresAt: true } });
  const day = todayUtc(at);
  for (const [kind, label] of [["INSURANCE", "L'assurance"], ["TECHNICAL_INSPECTION", "La visite technique"]] as const) {
    const s = complianceStatus(records, kind, day);
    if (s.state === "EXPIRED") throw businessRule(`${label} du véhicule ${vehicle.plate} a expiré le ${s.expiresAt!.toISOString().slice(0, 10)} : renouvelez-la avant de planifier ou démarrer une mission.`);
  }
}

