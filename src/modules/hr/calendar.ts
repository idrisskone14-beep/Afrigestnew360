import "server-only";
import { z } from "zod";
import { audit } from "@/core/audit";
import { businessRule, notFound } from "@/core/errors";
import type { Db } from "@/core/db/client";
import type { TenantContext } from "@/core/tenant/context";
import { parseDate } from "@/core/documents/lines";
import { DEFAULT_WORK_DAYS, holidaysFor, isoDay, type WorkCalendar } from "./leave-calc";

/**
 * Calendrier de travail d'une entreprise : jours travaillés de la semaine et jours fériés. Il sert au décompte des congés ET au calcul de la paie
 * (prorata d'un mois, jours non payés) : une seule source, donc les deux ne peuvent pas diverger.
 */
type Ctx = TenantContext;

const dayStart = (v: Date) => new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));

export async function loadWorkDays(db: Pick<Db, "hrSettings">): Promise<number[]> {
  const s = await db.hrSettings.findFirst({ select: { workDays: true } });
  return s && s.workDays.length > 0 ? s.workDays : [...DEFAULT_WORK_DAYS];
}

/** Calendrier couvrant une période (jours fériés de la période seulement : léger même pour une paie de plusieurs centaines de salariés). */
export async function loadCalendar(db: Pick<Db, "hrSettings" | "holiday">, from: Date, to: Date): Promise<WorkCalendar> {
  const [workDays, holidays] = await Promise.all([
    loadWorkDays(db),
    db.holiday.findMany({ where: { date: { gte: dayStart(from), lte: dayStart(to) } }, select: { date: true } }),
  ]);
  return { workDays: new Set(workDays), holidays: new Set(holidays.map((h) => isoDay(h.date))) };
}

export const workDaysSchema = z.object({ workDays: z.array(z.number().int().min(0).max(6)).min(1, "Au moins un jour travaillé").max(7) });
export const holidaySchema = z.object({ date: z.string().min(8, "Date requise"), name: z.string().trim().min(2, "Nom requis").max(100) });
export const generateHolidaysSchema = z.object({ country: z.string().min(2).max(10), year: z.coerce.number().int().min(2000).max(2100) });

export async function listHolidays(ctx: Ctx, year: number) {
  return ctx.db.holiday.findMany({ where: { date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } }, orderBy: { date: "asc" } });
}

export async function setWorkDays(ctx: Ctx, input: z.output<typeof workDaysSchema>) {
  const days = [...new Set(input.workDays)].sort((a, b) => a - b);
  await ctx.db.hrSettings.upsert({ where: { companyId: ctx.company.id }, create: { companyId: ctx.company.id, workDays: days }, update: { workDays: days } });
  await audit(ctx, { action: "hr.calendar.work_days", resource: "HrSettings", summary: `${ctx.user.name} a fixé les jours travaillés de la semaine (${days.join(", ")}).`, after: { workDays: days } });
}

export async function addHoliday(ctx: Ctx, input: z.output<typeof holidaySchema>) {
  const date = dayStart(parseDate(input.date)!);
  if (await ctx.db.holiday.findFirst({ where: { date }, select: { id: true } })) throw businessRule("Un jour férié existe déjà à cette date.");
  const h = await ctx.db.holiday.create({ data: { companyId: ctx.company.id, date, name: input.name.trim(), createdById: ctx.user.id } });
  await audit(ctx, { action: "hr.holiday.create", resource: "Holiday", resourceId: h.id, summary: `${ctx.user.name} a ajouté le jour férié « ${h.name} » (${isoDay(date)}).` });
  return h;
}

export async function deleteHoliday(ctx: Ctx, id: string) {
  const h = await ctx.db.holiday.findFirst({ where: { id } });
  if (!h) throw notFound("Jour férié");
  await ctx.db.holiday.delete({ where: { id } });
  await audit(ctx, { action: "hr.holiday.delete", resource: "Holiday", resourceId: id, summary: `${ctx.user.name} a supprimé le jour férié « ${h.name} » (${isoDay(h.date)}).` });
}

/** Ajoute les jours fériés calculables du pays pour l'année ; ceux dont la date existe déjà sont conservés tels quels. */
export async function generateHolidays(ctx: Ctx, input: z.output<typeof generateHolidaysSchema>) {
  const wanted = holidaysFor(input.country, input.year);
  const existing = new Set((await listHolidays(ctx, input.year)).map((h) => isoDay(h.date)));
  const fresh = wanted.filter((h) => !existing.has(h.date));
  if (fresh.length) await ctx.db.holiday.createMany({ data: fresh.map((h) => ({ companyId: ctx.company.id, date: new Date(`${h.date}T00:00:00.000Z`), name: h.name, createdById: ctx.user.id })) });
  await audit(ctx, { action: "hr.holiday.generate", resource: "Holiday", summary: `${ctx.user.name} a généré les jours fériés ${input.year} (${input.country}) : ${fresh.length} ajouté(s), ${wanted.length - fresh.length} déjà présent(s).` });
  return { added: fresh.length, skipped: wanted.length - fresh.length };
}
