import "server-only";
import { audit } from "@/core/audit";
import { parseDate } from "@/core/documents/lines";
import { businessRule, conflict, notFound } from "@/core/errors";
import { d, roundMoney } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { formatMoney } from "@/lib/reference-data";
import type { z } from "zod";
import { DAY, assertDriver, assertVehicle, driverAt, todayUtc } from "./service";
import type { fineSchema, fineStatusSchema, updateFineSchema } from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);

/** Transitions autorisées : une contravention PAYÉE ou ANNULÉE est définitive. */
export const FINE_TRANSITIONS: Record<string, string[]> = {
  TO_PAY: ["PAID", "CONTESTED", "CANCELLED"],
  CONTESTED: ["PAID", "TO_PAY", "CANCELLED"],
  PAID: [],
  CANCELLED: [],
};

export async function listFines(ctx: Ctx, p: { q?: string; status?: string; vehicleId?: string; driverId?: string; overdue?: boolean; skip: number; take: number }) {
  const today = todayUtc();
  const where = {
    vehicleId: p.vehicleId, driverId: p.driverId,
    ...(p.status ? { status: p.status as never } : {}),
    ...(p.overdue ? { status: "TO_PAY" as const, dueDate: { lt: today } } : {}),
    ...(p.q ? { OR: [{ number: { contains: p.q, mode: "insensitive" as const } }, { offence: { contains: p.q, mode: "insensitive" as const } }, { place: { contains: p.q, mode: "insensitive" as const } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.trafficFine.count({ where }),
    ctx.db.trafficFine.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: p.skip, take: p.take, include: { vehicle: { select: { id: true, plate: true } }, driver: { select: { id: true, fullName: true } } } }),
  ]);
  return { total, rows };
}

export async function getFine(ctx: Ctx, id: string) {
  const f = await ctx.db.trafficFine.findFirst({ where: { id }, include: { vehicle: { select: { id: true, plate: true } }, driver: { select: { id: true, fullName: true } } } });
  if (!f) throw notFound("Contravention");
  return f;
}

/** Date/heure de l'infraction (UTC) servant à retrouver le chauffeur au volant. */
const when = (date: Date, time?: string | null) => new Date(date.getTime() + (time ? (Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))) * 60_000 : 12 * 3_600_000));

async function resolveDriver(ctx: Ctx, vehicleId: string, driverId: string | undefined, date: Date, time?: string | null) {
  if (driverId) { await assertDriver(ctx.db, driverId); return { id: driverId, auto: false }; }
  const id = await driverAt(ctx.db, vehicleId, when(date, time));
  return { id, auto: id !== null };
}

export async function createFine(ctx: Ctx, input: z.output<typeof fineSchema>) {
  const v = await assertVehicle(ctx.db, input.vehicleId);
  const number = input.number.trim().toUpperCase();
  if (await ctx.db.trafficFine.findFirst({ where: { number }, select: { id: true } })) throw conflict(`Le PV ${number} est déjà enregistré.`);
  const date = parseDate(input.date)!;
  if (date > new Date(todayUtc().getTime() + DAY)) throw businessRule("La date de l'infraction est dans le futur.");
  const due = parseDate(input.dueDate);
  if (due && due < date) throw businessRule("L'échéance de paiement précède l'infraction.");
  const driver = await resolveDriver(ctx, v.id, input.driverId || undefined, date, input.time);
  const fine = await ctx.db.trafficFine.create({
    data: { companyId: ctx.company.id, number, vehicleId: v.id, driverId: driver.id, date, time: blank(input.time), place: blank(input.place), offence: input.offence.trim(), amount: roundMoney(input.amount, ctx.company.currency).toString(), dueDate: due, notes: blank(input.notes), createdById: ctx.user.id },
  });
  await audit(ctx, { action: "fleet.fine.create", resource: "TrafficFine", resourceId: fine.id, summary: `${ctx.user.name} a enregistré le PV ${number} (${fine.offence}, ${formatMoney(d(fine.amount).toNumber(), ctx.company.currency)}) pour ${v.plate}${driver.auto ? " — chauffeur déduit de la mission/affectation" : ""}.` });
  return fine;
}

export async function updateFine(ctx: Ctx, input: z.output<typeof updateFineSchema>) {
  const before = await getFine(ctx, input.id);
  if (before.status === "PAID" || before.status === "CANCELLED") throw businessRule("Une contravention payée ou annulée n'est plus modifiable.");
  const v = await assertVehicle(ctx.db, input.vehicleId);
  const number = input.number.trim().toUpperCase();
  if (number !== before.number && (await ctx.db.trafficFine.findFirst({ where: { number, id: { not: input.id } }, select: { id: true } }))) throw conflict(`Le PV ${number} est déjà enregistré.`);
  const date = parseDate(input.date)!;
  const due = parseDate(input.dueDate);
  if (due && due < date) throw businessRule("L'échéance de paiement précède l'infraction.");
  const driver = await resolveDriver(ctx, v.id, input.driverId || undefined, date, input.time);
  const fine = await ctx.db.trafficFine.update({
    where: { id: input.id },
    data: { number, vehicleId: v.id, driverId: driver.id, date, time: blank(input.time), place: blank(input.place), offence: input.offence.trim(), amount: roundMoney(input.amount, ctx.company.currency).toString(), dueDate: due, notes: blank(input.notes) },
  });
  await audit(ctx, { action: "fleet.fine.update", resource: "TrafficFine", resourceId: fine.id, summary: `${ctx.user.name} a modifié le PV ${fine.number}.`, before: { amount: d(before.amount).toNumber(), vehicleId: before.vehicleId }, after: { amount: d(fine.amount).toNumber(), vehicleId: fine.vehicleId } });
  return fine;
}

export async function setFineStatus(ctx: Ctx, input: z.output<typeof fineStatusSchema>) {
  const f = await getFine(ctx, input.id);
  if (f.status === input.status) throw businessRule("La contravention a déjà ce statut.");
  if (!FINE_TRANSITIONS[f.status]!.includes(input.status)) throw businessRule(`Une contravention « ${f.status === "PAID" ? "payée" : f.status === "CANCELLED" ? "annulée" : "à payer"} » ne peut pas passer à ce statut.`);
  const data: Record<string, unknown> = { status: input.status };
  if (input.status === "PAID") {
    const paidAt = parseDate(input.paidAt) ?? todayUtc();
    if (paidAt < f.date) throw businessRule("Le paiement précède l'infraction.");
    data.paidAt = paidAt; data.contestReason = null;
  } else if (input.status === "CONTESTED") {
    if (!input.reason?.trim()) throw businessRule("Indiquez le motif de la contestation.");
    data.contestReason = input.reason.trim();
  } else if (input.status === "CANCELLED") {
    if (f.expenseId) throw businessRule("Cette contravention est rattachée à une dépense : annulez la dépense dans Finance d'abord.");
    data.contestReason = input.reason?.trim() || f.contestReason;
  } else data.contestReason = null;
  const claim = await ctx.db.trafficFine.updateMany({ where: { id: f.id, status: f.status }, data: data as never });
  if (claim.count !== 1) throw conflict("La contravention a été modifiée entre-temps : actualisez la page.");
  const label: Record<string, string> = { PAID: "payée", CONTESTED: "contestée", CANCELLED: "annulée", TO_PAY: "à payer" };
  await audit(ctx, { action: `fleet.fine.${input.status.toLowerCase()}`, resource: "TrafficFine", resourceId: f.id, summary: `${ctx.user.name} a marqué le PV ${f.number} comme ${label[input.status]}${input.reason ? ` (${input.reason})` : ""}.` });
}

export async function deleteFine(ctx: Ctx, id: string) {
  const f = await getFine(ctx, id);
  if (f.expenseId) throw businessRule("Cette contravention est rattachée à une dépense : annulez la dépense dans Finance d'abord.");
  if (f.status === "PAID") throw businessRule("Une contravention payée ne se supprime pas : conservez l'historique.");
  await ctx.db.trafficFine.delete({ where: { id } });
  await audit(ctx, { action: "fleet.fine.delete", resource: "TrafficFine", resourceId: id, summary: `${ctx.user.name} a supprimé le PV ${f.number}.` });
}

// ═══ Analyses ═════════════════════════════════════════════════

export interface FineRow { id: string; date: Date; amount: number; status: string; offence: string; vehicleId: string; vehicle: string; driverId: string | null; driver: string | null }
const monthKey = (dt: Date) => `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
const normOffence = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Analyses des contraventions (hors annulées) : total, par véhicule, par chauffeur, infractions fréquentes, évolution mensuelle
 * et RÉCIDIVES (chauffeur ou véhicule avec au moins 2 PV sur les 12 mois précédant `asOf` ; chauffeur répétant une même infraction).
 * Pur et testé.
 */
export function analyzeFines(rows: FineRow[], asOf = new Date()) {
  const live = rows.filter((r) => r.status !== "CANCELLED");
  const sum = (xs: FineRow[]) => Math.round(xs.reduce((a, r) => a + r.amount, 0) * 100) / 100;
  const group = <K extends string>(key: (r: FineRow) => K | null, label: (r: FineRow) => string) => {
    const m = new Map<string, { label: string; count: number; amount: number }>();
    for (const r of live) { const k = key(r); if (k === null) continue; const g = m.get(k) ?? { label: label(r), count: 0, amount: 0 }; g.count++; g.amount = Math.round((g.amount + r.amount) * 100) / 100; m.set(k, g); }
    return [...m.entries()].map(([id, g]) => ({ id, ...g })).sort((a, b) => b.amount - a.amount || b.count - a.count);
  };
  const byStatus = new Map<string, { count: number; amount: number }>();
  for (const r of rows) { const g = byStatus.get(r.status) ?? { count: 0, amount: 0 }; g.count++; g.amount += r.amount; byStatus.set(r.status, g); }
  const offences = new Map<string, { label: string; count: number; amount: number }>();
  for (const r of live) { const k = normOffence(r.offence); const g = offences.get(k) ?? { label: r.offence, count: 0, amount: 0 }; g.count++; g.amount += r.amount; offences.set(k, g); }
  const monthly = new Map<string, { count: number; amount: number }>();
  for (const r of live) { const g = monthly.get(monthKey(r.date)) ?? { count: 0, amount: 0 }; g.count++; g.amount += r.amount; monthly.set(monthKey(r.date), g); }

  const since = new Date(asOf.getTime() - 365 * DAY);
  const recent = live.filter((r) => r.date >= since && r.date <= asOf);
  const repeat = (key: (r: FineRow) => string | null, label: (r: FineRow) => string) => {
    const m = new Map<string, { label: string; count: number; amount: number }>();
    for (const r of recent) { const k = key(r); if (k === null) continue; const g = m.get(k) ?? { label: label(r), count: 0, amount: 0 }; g.count++; g.amount += r.amount; m.set(k, g); }
    return [...m.entries()].filter(([, g]) => g.count >= 2).map(([id, g]) => ({ id, ...g })).sort((a, b) => b.count - a.count || b.amount - a.amount);
  };
  const sameOffence = new Map<string, { driver: string; offence: string; count: number }>();
  for (const r of recent) { if (!r.driverId) continue; const k = `${r.driverId}|${normOffence(r.offence)}`; const g = sameOffence.get(k) ?? { driver: r.driver ?? "", offence: r.offence, count: 0 }; g.count++; sameOffence.set(k, g); }

  return {
    count: live.length, total: sum(live),
    byStatus: [...byStatus.entries()].map(([status, g]) => ({ status, ...g })),
    byVehicle: group((r) => r.vehicleId, (r) => r.vehicle), byDriver: group((r) => r.driverId, (r) => r.driver ?? ""),
    offences: [...offences.values()].sort((a, b) => b.count - a.count || b.amount - a.amount),
    monthly: [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, g]) => ({ month, ...g })),
    repeatDrivers: repeat((r) => r.driverId, (r) => r.driver ?? ""), repeatVehicles: repeat((r) => r.vehicleId, (r) => r.vehicle),
    repeatedOffences: [...sameOffence.values()].filter((g) => g.count >= 2).sort((a, b) => b.count - a.count),
    unassigned: live.filter((r) => r.driverId === null).length,
  };
}

export async function fineAnalytics(ctx: Ctx, f: { from?: Date; to?: Date; vehicleId?: string; driverId?: string }) {
  const rows = await ctx.db.trafficFine.findMany({
    where: { vehicleId: f.vehicleId, driverId: f.driverId, ...(f.from || f.to ? { date: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}) },
    orderBy: { date: "asc" }, take: 20_000, include: { vehicle: { select: { plate: true } }, driver: { select: { fullName: true } } },
  });
  return analyzeFines(rows.map((r) => ({ id: r.id, date: r.date, amount: d(r.amount).toNumber(), status: r.status, offence: r.offence, vehicleId: r.vehicleId, vehicle: r.vehicle.plate, driverId: r.driverId, driver: r.driver?.fullName ?? null })), f.to ? new Date(f.to.getTime() - DAY) : new Date());
}
