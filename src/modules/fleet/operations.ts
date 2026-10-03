import "server-only";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { parseDate } from "@/core/documents/lines";
import { businessRule, notFound } from "@/core/errors";
import { d, roundMoney } from "@/core/money";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import { formatMoney } from "@/lib/reference-data";
import type { z } from "zod";
import { DAY, applyOdometer, assertDriver, assertRoadworthy, assertVehicle, licenseValid, todayUtc } from "./service";
import type { completeMaintenanceSchema, finishTripSchema, fuelSchema, maintenanceSchema, startTripSchema, tripSchema, updateMaintenanceSchema, updateTripSchema } from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const km = (v: unknown) => (v === "" || v === undefined || v === null ? null : Number(v));
const iso = (dt: Date) => dt.toISOString().slice(0, 10);

// ═══ Missions ═════════════════════════════════════════════════

function dt(v: string, label: string): Date {
  const x = new Date(v.length === 16 ? `${v}:00Z` : v); // « YYYY-MM-DDTHH:MM » saisi en heure locale de l'entreprise, stocké tel quel
  if (Number.isNaN(x.getTime())) throw businessRule(`${label} invalide.`);
  return x;
}

interface Window { start: Date; end: Date }
const overlap = (a: Window, b: Window) => a.start < b.end && b.start < a.end;

/** Fenêtre d'occupation d'une mission : début réel ou prévu → fin réelle ou prévue (24 h par défaut). */
const windowOf = (t: { plannedStart: Date; plannedEnd: Date | null; startedAt: Date | null; endedAt: Date | null }): Window => {
  const start = t.startedAt ?? t.plannedStart;
  return { start, end: t.endedAt ?? t.plannedEnd ?? new Date(start.getTime() + DAY) };
};

/** Aucune autre mission (planifiée ou en cours) ne doit occuper le véhicule ni le chauffeur sur cette fenêtre. */
async function assertAvailable(tx: Db, input: { vehicleId: string; driverId: string; start: Date; end: Date; ignoreTripId?: string }) {
  const w = { start: input.start, end: input.end };
  const others = await tx.trip.findMany({
    where: { status: { in: ["PLANNED", "IN_PROGRESS"] }, id: input.ignoreTripId ? { not: input.ignoreTripId } : undefined, OR: [{ vehicleId: input.vehicleId }, { driverId: input.driverId }] },
    select: { number: true, vehicleId: true, driverId: true, plannedStart: true, plannedEnd: true, startedAt: true, endedAt: true },
  });
  for (const o of others) {
    if (!overlap(w, windowOf(o))) continue;
    throw businessRule(`${o.vehicleId === input.vehicleId ? "Le véhicule" : "Le chauffeur"} est déjà occupé par la mission ${o.number} sur cette période.`);
  }
}

async function lockResources(tx: Db, vehicleId: string, driverId: string) {
  await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${vehicleId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Driver" WHERE id = ${driverId}::uuid FOR UPDATE`;
}

async function checkTripRefs(ctx: Ctx, input: { customerId?: string; projectId?: string }) {
  if (input.customerId && ctx.hasModule("crm") && !(await ctx.db.customer.findFirst({ where: { id: input.customerId, deletedAt: null }, select: { id: true } }))) throw notFound("Client");
  if (input.customerId && !ctx.hasModule("crm")) throw businessRule("Le module Clients n'est pas activé.");
  if (input.projectId && !(ctx.hasModule("projects") && (await ctx.db.project.findFirst({ where: { id: input.projectId, deletedAt: null }, select: { id: true } })))) throw notFound("Projet");
}

export async function listTrips(ctx: Ctx, p: { status?: string; vehicleId?: string; driverId?: string; from?: Date; to?: Date; skip: number; take: number }) {
  const where = { ...(p.status ? { status: p.status as never } : {}), vehicleId: p.vehicleId, driverId: p.driverId, ...(p.from || p.to ? { plannedStart: { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lt: p.to } : {}) } } : {}) };
  const [total, rows] = await Promise.all([
    ctx.db.trip.count({ where }),
    ctx.db.trip.findMany({ where, orderBy: { plannedStart: "desc" }, skip: p.skip, take: p.take, include: { vehicle: { select: { id: true, plate: true, odometer: true } }, driver: { select: { id: true, fullName: true } } } }),
  ]);
  return { total, rows };
}

export async function getTrip(ctx: Ctx, id: string) {
  const t = await ctx.db.trip.findFirst({ where: { id }, include: { vehicle: { select: { id: true, plate: true } }, driver: { select: { id: true, fullName: true } } } });
  if (!t) throw notFound("Mission");
  return t;
}

async function validateTrip(ctx: Ctx, input: z.output<typeof tripSchema>, ignoreTripId?: string) {
  const vehicle = await assertVehicle(ctx.db, input.vehicleId, { active: true });
  const driver = await assertDriver(ctx.db, input.driverId, { active: true });
  const start = dt(input.plannedStart, "Date de départ");
  const end = input.plannedEnd ? dt(input.plannedEnd, "Date d'arrivée") : null;
  if (end && end <= start) throw businessRule("L'arrivée doit suivre le départ.");
  if (!licenseValid(driver, start)) throw businessRule(`Le permis de ${driver.fullName} est expiré à la date du départ.`);
  await assertRoadworthy(ctx.db, vehicle, start);
  await checkTripRefs(ctx, { customerId: input.customerId || undefined, projectId: input.projectId || undefined });
  return { vehicle, driver, start, end, ignoreTripId };
}

export async function createTrip(ctx: Ctx, input: z.output<typeof tripSchema>) {
  const v = await validateTrip(ctx, input);
  const trip = await ctx.tx(async (tx) => {
    await lockResources(tx, v.vehicle.id, v.driver.id);
    await assertAvailable(tx, { vehicleId: v.vehicle.id, driverId: v.driver.id, start: v.start, end: v.end ?? new Date(v.start.getTime() + DAY) });
    const number = await nextNumber(tx, ctx.company.id, "trip", v.start);
    return tx.trip.create({
      data: {
        companyId: ctx.company.id, number, vehicleId: v.vehicle.id, driverId: v.driver.id, origin: input.origin.trim(), destination: input.destination.trim(), purpose: blank(input.purpose), plannedStart: v.start, plannedEnd: v.end,
        cargo: blank(input.cargo), customerId: input.customerId || null, projectId: input.projectId || null, revenue: roundMoney(input.revenue, ctx.company.currency).toString(), notes: blank(input.notes), createdById: ctx.user.id,
      },
    });
  });
  await audit(ctx, { action: "fleet.trip.create", resource: "Trip", resourceId: trip.id, summary: `${ctx.user.name} a planifié la mission ${trip.number} (${trip.origin} → ${trip.destination}, ${v.vehicle.plate}, ${v.driver.fullName}).` });
  return trip;
}

export async function updateTrip(ctx: Ctx, input: z.output<typeof updateTripSchema>) {
  const before = await getTrip(ctx, input.id);
  if (before.status !== "PLANNED") throw businessRule("Seule une mission planifiée peut être modifiée.");
  const v = await validateTrip(ctx, input, input.id);
  const trip = await ctx.tx(async (tx) => {
    await lockResources(tx, v.vehicle.id, v.driver.id);
    await assertAvailable(tx, { vehicleId: v.vehicle.id, driverId: v.driver.id, start: v.start, end: v.end ?? new Date(v.start.getTime() + DAY), ignoreTripId: input.id });
    return tx.trip.update({
      where: { id: input.id },
      data: { vehicleId: v.vehicle.id, driverId: v.driver.id, origin: input.origin.trim(), destination: input.destination.trim(), purpose: blank(input.purpose), plannedStart: v.start, plannedEnd: v.end, cargo: blank(input.cargo), customerId: input.customerId || null, projectId: input.projectId || null, revenue: roundMoney(input.revenue, ctx.company.currency).toString(), notes: blank(input.notes) },
    });
  });
  await audit(ctx, { action: "fleet.trip.update", resource: "Trip", resourceId: trip.id, summary: `${ctx.user.name} a modifié la mission ${trip.number}.` });
  return trip;
}

/** Départ réel : revérifie véhicule, chauffeur, permis et conformité à l'instant du départ. */
export async function startTrip(ctx: Ctx, input: z.output<typeof startTripSchema>) {
  const t = await getTrip(ctx, input.id);
  if (t.status !== "PLANNED") throw businessRule("Seule une mission planifiée peut démarrer.");
  const vehicle = await assertVehicle(ctx.db, t.vehicleId, { active: true });
  const driver = await assertDriver(ctx.db, t.driverId, { active: true });
  const now = new Date();
  if (!licenseValid(driver, now)) throw businessRule(`Le permis de ${driver.fullName} est expiré.`);
  await assertRoadworthy(ctx.db, vehicle, now);
  const startKm = km(input.startKm) ?? vehicle.odometer;
  if (startKm < vehicle.odometer) throw businessRule(`Kilométrage de départ inférieur au compteur du véhicule (${vehicle.odometer.toLocaleString("fr-FR")} km).`);
  const started = await ctx.tx(async (tx) => {
    await lockResources(tx, vehicle.id, driver.id);
    const busy = await tx.trip.findFirst({ where: { status: "IN_PROGRESS", id: { not: t.id }, OR: [{ vehicleId: vehicle.id }, { driverId: driver.id }] }, select: { number: true } });
    if (busy) throw businessRule(`Le véhicule ou le chauffeur est déjà en mission (${busy.number}).`);
    await applyOdometer(tx, vehicle.id, startKm);
    const claim = await tx.trip.updateMany({ where: { id: t.id, status: "PLANNED" }, data: { status: "IN_PROGRESS", startedAt: now, startKm } });
    if (claim.count !== 1) throw businessRule("Cette mission a déjà démarré.");
    return tx.trip.findFirstOrThrow({ where: { id: t.id } });
  });
  await audit(ctx, { action: "fleet.trip.start", resource: "Trip", resourceId: t.id, summary: `${ctx.user.name} a démarré la mission ${t.number} (${vehicle.plate}, départ à ${startKm.toLocaleString("fr-FR")} km).` });
  return started;
}

export async function finishTrip(ctx: Ctx, input: z.output<typeof finishTripSchema>) {
  const t = await getTrip(ctx, input.id);
  if (t.status !== "IN_PROGRESS" || t.startKm === null) throw businessRule("Seule une mission en cours peut être clôturée.");
  if (input.endKm < t.startKm) throw businessRule(`Le kilométrage d'arrivée est inférieur au départ (${t.startKm.toLocaleString("fr-FR")} km).`);
  const distance = input.endKm - t.startKm;
  const revenue = input.revenue === "" || input.revenue === undefined ? undefined : roundMoney(input.revenue, ctx.company.currency).toString();
  const done = await ctx.tx(async (tx) => {
    await lockResources(tx, t.vehicleId, t.driverId);
    await applyOdometer(tx, t.vehicleId, input.endKm);
    const claim = await tx.trip.updateMany({ where: { id: t.id, status: "IN_PROGRESS" }, data: { status: "DONE", endedAt: new Date(), endKm: input.endKm, distanceKm: distance, ...(revenue !== undefined ? { revenue } : {}), notes: blank(input.notes) ?? t.notes } });
    if (claim.count !== 1) throw businessRule("Cette mission est déjà clôturée.");
    return tx.trip.findFirstOrThrow({ where: { id: t.id } });
  });
  await audit(ctx, { action: "fleet.trip.finish", resource: "Trip", resourceId: t.id, summary: `${ctx.user.name} a clôturé la mission ${t.number} : ${distance.toLocaleString("fr-FR")} km${done.revenue && d(done.revenue).gt(0) ? `, produit ${formatMoney(d(done.revenue).toNumber(), ctx.company.currency)}` : ""}.` });
  return done;
}

export async function cancelTrip(ctx: Ctx, id: string) {
  const t = await getTrip(ctx, id);
  if (t.status !== "PLANNED" && t.status !== "IN_PROGRESS") throw businessRule("Cette mission est déjà terminée ou annulée.");
  await ctx.db.trip.update({ where: { id }, data: { status: "CANCELLED" } });
  await audit(ctx, { action: "fleet.trip.cancel", resource: "Trip", resourceId: id, summary: `${ctx.user.name} a annulé la mission ${t.number}.` });
}

// ═══ Carburant ════════════════════════════════════════════════

export async function listFuel(ctx: Ctx, p: { vehicleId?: string; from?: Date; to?: Date; skip: number; take: number }) {
  const where = { vehicleId: p.vehicleId, ...(p.from || p.to ? { date: { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lt: p.to } : {}) } } : {}) };
  const [total, rows] = await Promise.all([
    ctx.db.fuelLog.count({ where }),
    ctx.db.fuelLog.findMany({ where, orderBy: [{ date: "desc" }, { odometer: "desc" }], skip: p.skip, take: p.take, include: { vehicle: { select: { id: true, plate: true } }, driver: { select: { fullName: true } } } }),
  ]);
  return { total, rows };
}

export async function addFuel(ctx: Ctx, input: z.output<typeof fuelSchema>) {
  const v = await assertVehicle(ctx.db, input.vehicleId);
  if (v.fuelType === "NONE") throw businessRule("Ce véhicule n'a pas de moteur : pas de carburant.");
  if (input.driverId) await assertDriver(ctx.db, input.driverId);
  const date = parseDate(input.date)!;
  if (date > new Date(todayUtc().getTime() + DAY)) throw businessRule("La date du plein est dans le futur.");
  const price = input.unitPrice === "" || input.unitPrice === undefined ? null : Number(input.unitPrice);
  const total = input.amount === "" || input.amount === undefined ? null : Number(input.amount);
  if (price === null && total === null) throw businessRule("Indiquez le prix au litre ou le montant payé.");
  const amount = total !== null ? roundMoney(total, ctx.company.currency) : roundMoney(d(price).mul(input.liters), ctx.company.currency);
  const unit = price !== null ? d(price) : amount.div(input.liters).toDecimalPlaces(2);
  const log = await ctx.tx(async (tx) => {
    await applyOdometer(tx, v.id, input.odometer, date);
    return tx.fuelLog.create({ data: { companyId: ctx.company.id, vehicleId: v.id, driverId: input.driverId || null, date, liters: input.liters.toString(), unitPrice: unit.toString(), amount: amount.toString(), odometer: input.odometer, fullTank: input.fullTank, station: blank(input.station), notes: blank(input.notes), createdById: ctx.user.id } });
  });
  await audit(ctx, { action: "fleet.fuel.create", resource: "FuelLog", resourceId: log.id, summary: `${ctx.user.name} a enregistré un plein de ${input.liters} L (${formatMoney(amount.toNumber(), ctx.company.currency)}) pour ${v.plate} à ${input.odometer.toLocaleString("fr-FR")} km.` });
  return log;
}

export async function deleteFuel(ctx: Ctx, id: string) {
  const f = await ctx.db.fuelLog.findFirst({ where: { id }, include: { vehicle: { select: { plate: true } } } });
  if (!f) throw notFound("Plein");
  if (f.expenseId) throw businessRule("Ce plein est rattaché à une dépense : annulez la dépense dans Finance d'abord.");
  await ctx.db.fuelLog.delete({ where: { id } });
  await audit(ctx, { action: "fleet.fuel.delete", resource: "FuelLog", resourceId: id, summary: `${ctx.user.name} a supprimé un plein de ${f.vehicle.plate} (${iso(f.date)}).` });
}

/**
 * Consommation (L/100 km) entre pleins complets : pour chaque plein complet, les litres pris depuis le plein complet précédent
 * (celui-ci inclus) divisés par la distance parcourue. Pur et testé.
 */
export function fuelStats(logs: { date: Date; liters: number; odometer: number; fullTank: boolean }[]) {
  const sorted = [...logs].sort((a, b) => a.odometer - b.odometer || a.date.getTime() - b.date.getTime());
  let lastFull: number | null = null, litersSince = 0;
  const segments: { odometer: number; distance: number; liters: number; per100: number }[] = [];
  for (const l of sorted) {
    if (lastFull === null) { if (l.fullTank) lastFull = l.odometer; continue; } // les litres avant le 1er plein complet ne sont pas mesurables
    litersSince += l.liters;
    if (!l.fullTank) continue;
    const distance = l.odometer - lastFull;
    if (distance > 0) segments.push({ odometer: l.odometer, distance, liters: litersSince, per100: Math.round((litersSince / distance) * 1000) / 10 });
    lastFull = l.odometer; litersSince = 0;
  }
  const distance = segments.reduce((a, s) => a + s.distance, 0), liters = segments.reduce((a, s) => a + s.liters, 0);
  return { segments, distance, liters, per100: distance > 0 ? Math.round((liters / distance) * 1000) / 10 : null };
}

// ═══ Entretiens et réparations ════════════════════════════════

export async function listMaintenance(ctx: Ctx, p: { vehicleId?: string; status?: string; skip: number; take: number }) {
  const where = { vehicleId: p.vehicleId, ...(p.status ? { status: p.status as never } : {}) };
  const [total, rows] = await Promise.all([
    ctx.db.maintenanceRecord.count({ where }),
    ctx.db.maintenanceRecord.findMany({ where, orderBy: [{ date: "desc" }], skip: p.skip, take: p.take, include: { vehicle: { select: { id: true, plate: true } } } }),
  ]);
  return { total, rows };
}

async function checkMaintenance(ctx: Ctx, input: z.output<typeof maintenanceSchema>) {
  const v = await assertVehicle(ctx.db, input.vehicleId);
  if (input.supplierId && !(ctx.hasModule("purchases") && (await ctx.db.supplier.findFirst({ where: { id: input.supplierId, deletedAt: null }, select: { id: true } })))) throw notFound("Fournisseur");
  const next = parseDate(input.nextDueDate);
  if (next && next < parseDate(input.date)!) throw businessRule("La prochaine échéance précède l'entretien.");
  const odo = km(input.odometer);
  if (input.status === "DONE" && parseDate(input.date)! > new Date(todayUtc().getTime() + DAY)) throw businessRule("Un entretien réalisé ne peut pas être daté du futur : planifiez-le.");
  return { v, next, odo };
}

export async function addMaintenance(ctx: Ctx, input: z.output<typeof maintenanceSchema>) {
  const { v, next, odo } = await checkMaintenance(ctx, input);
  const rec = await ctx.tx(async (tx) => {
    if (input.status === "DONE" && odo !== null) await applyOdometer(tx, v.id, odo, parseDate(input.date)!);
    return tx.maintenanceRecord.create({
      data: { companyId: ctx.company.id, vehicleId: v.id, type: input.type as never, status: input.status as never, date: parseDate(input.date)!, odometer: odo, description: input.description.trim(), supplierId: input.supplierId || null, cost: roundMoney(input.cost, ctx.company.currency).toString(), nextDueDate: next, nextDueKm: km(input.nextDueKm), notes: blank(input.notes), createdById: ctx.user.id },
    });
  });
  await audit(ctx, { action: "fleet.maintenance.create", resource: "MaintenanceRecord", resourceId: rec.id, summary: `${ctx.user.name} a ${input.status === "DONE" ? "enregistré" : "planifié"} l'entretien « ${rec.description} » du véhicule ${v.plate}.` });
  return rec;
}

export async function updateMaintenance(ctx: Ctx, input: z.output<typeof updateMaintenanceSchema>) {
  const before = await ctx.db.maintenanceRecord.findFirst({ where: { id: input.id } });
  if (!before) throw notFound("Entretien");
  if (before.expenseId) throw businessRule("Cet entretien est rattaché à une dépense : il n'est plus modifiable.");
  if (before.vehicleId !== input.vehicleId) throw businessRule("Le véhicule d'un entretien ne peut pas changer.");
  const { v, next, odo } = await checkMaintenance(ctx, input);
  const rec = await ctx.tx(async (tx) => {
    if (input.status === "DONE" && odo !== null) await applyOdometer(tx, v.id, odo, parseDate(input.date)!);
    return tx.maintenanceRecord.update({ where: { id: input.id }, data: { type: input.type as never, status: input.status as never, date: parseDate(input.date)!, odometer: odo, description: input.description.trim(), supplierId: input.supplierId || null, cost: roundMoney(input.cost, ctx.company.currency).toString(), nextDueDate: next, nextDueKm: km(input.nextDueKm), notes: blank(input.notes) } });
  });
  await audit(ctx, { action: "fleet.maintenance.update", resource: "MaintenanceRecord", resourceId: rec.id, summary: `${ctx.user.name} a modifié l'entretien « ${rec.description} » de ${v.plate}.` });
  return rec;
}

/** Un entretien planifié devient réalisé : date, kilométrage, coût réels et prochaine échéance. */
export async function completeMaintenance(ctx: Ctx, input: z.output<typeof completeMaintenanceSchema>) {
  const before = await ctx.db.maintenanceRecord.findFirst({ where: { id: input.id }, include: { vehicle: { select: { plate: true } } } });
  if (!before) throw notFound("Entretien");
  if (before.status !== "PLANNED") throw businessRule("Seul un entretien planifié peut être marqué comme réalisé.");
  const date = parseDate(input.date)!;
  if (date > new Date(todayUtc().getTime() + DAY)) throw businessRule("La date de réalisation est dans le futur.");
  const next = parseDate(input.nextDueDate);
  if (next && next < date) throw businessRule("La prochaine échéance précède l'entretien.");
  const odo = km(input.odometer);
  const rec = await ctx.tx(async (tx) => {
    if (odo !== null) await applyOdometer(tx, before.vehicleId, odo, date);
    const claim = await tx.maintenanceRecord.updateMany({ where: { id: input.id, status: "PLANNED" }, data: { status: "DONE", date, odometer: odo, cost: roundMoney(input.cost, ctx.company.currency).toString(), nextDueDate: next, nextDueKm: km(input.nextDueKm), notes: blank(input.notes) ?? before.notes } });
    if (claim.count !== 1) throw businessRule("Cet entretien est déjà traité.");
    return tx.maintenanceRecord.findFirstOrThrow({ where: { id: input.id } });
  });
  await audit(ctx, { action: "fleet.maintenance.complete", resource: "MaintenanceRecord", resourceId: input.id, summary: `${ctx.user.name} a réalisé l'entretien « ${before.description} » de ${before.vehicle.plate} (${formatMoney(d(rec.cost).toNumber(), ctx.company.currency)}).` });
  return rec;
}

export async function cancelMaintenance(ctx: Ctx, id: string) {
  const m = await ctx.db.maintenanceRecord.findFirst({ where: { id }, include: { vehicle: { select: { plate: true } } } });
  if (!m) throw notFound("Entretien");
  if (m.status !== "PLANNED") throw businessRule("Seul un entretien planifié peut être annulé.");
  await ctx.db.maintenanceRecord.update({ where: { id }, data: { status: "CANCELLED" } });
  await audit(ctx, { action: "fleet.maintenance.cancel", resource: "MaintenanceRecord", resourceId: id, summary: `${ctx.user.name} a annulé l'entretien « ${m.description} » de ${m.vehicle.plate}.` });
}

export async function deleteMaintenance(ctx: Ctx, id: string) {
  const m = await ctx.db.maintenanceRecord.findFirst({ where: { id }, include: { vehicle: { select: { plate: true } } } });
  if (!m) throw notFound("Entretien");
  if (m.expenseId) throw businessRule("Cet entretien est rattaché à une dépense : annulez la dépense dans Finance d'abord.");
  await ctx.db.maintenanceRecord.delete({ where: { id } });
  await audit(ctx, { action: "fleet.maintenance.delete", resource: "MaintenanceRecord", resourceId: id, summary: `${ctx.user.name} a supprimé l'entretien « ${m.description} » de ${m.vehicle.plate}.` });
}
