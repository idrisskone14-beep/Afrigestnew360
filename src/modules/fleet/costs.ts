import "server-only";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { businessRule, forbidden, notFound } from "@/core/errors";
import { d, type Numeric } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { formatMoney } from "@/lib/reference-data";
import * as expenses from "@/modules/finance/expenses";
import { expenseSchema } from "@/modules/finance/schemas";
import { fuelStats } from "./operations";
import { DAY, ROAD_TYPES, complianceStatus, todayUtc } from "./service";

type Ctx = TenantContext;
const round = (n: number) => Math.round(n * 100) / 100;
const range = (f: { from?: Date; to?: Date }) => (f.from || f.to ? { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } : undefined);

// ═══ Coûts et rentabilité par véhicule ════════════════════════

export interface VehicleEconomics {
  vehicleId: string; plate: string; label: string; trips: number; km: number; revenue: number;
  fuel: number; liters: number; per100: number | null; maintenance: number; compliance: number; fines: number;
  cost: number; margin: number; costPerKm: number | null;
}

/**
 * Coût et rentabilité par véhicule sur une période : produit des missions terminées (date de clôture) moins carburant, entretiens réalisés,
 * assurances / visites (date de début), contraventions non annulées (date de l'infraction). Chaque coût vient de l'enregistrement de la flotte :
 * une dépense créée dans Finance à partir de cet enregistrement n'est jamais comptée une seconde fois.
 */
export async function vehicleEconomics(ctx: Ctx, f: { from?: Date; to?: Date; vehicleId?: string; branchId?: string; costCenterId?: string }): Promise<VehicleEconomics[]> {
  const vehicles = await ctx.db.vehicle.findMany({ where: { deletedAt: null, id: f.vehicleId, branchId: f.branchId, costCenterId: f.costCenterId }, orderBy: { plate: "asc" }, select: { id: true, plate: true, name: true, brand: true, model: true } });
  const ids = vehicles.map((v) => v.id);
  const [trips, fuel, maint, comp, fines] = await Promise.all([
    ctx.db.trip.groupBy({ by: ["vehicleId"], where: { vehicleId: { in: ids }, status: "DONE", endedAt: range(f) }, _count: { _all: true }, _sum: { distanceKm: true, revenue: true } }),
    ctx.db.fuelLog.findMany({ where: { vehicleId: { in: ids }, date: range(f) }, select: { vehicleId: true, date: true, liters: true, amount: true, odometer: true, fullTank: true }, take: 50_000 }),
    ctx.db.maintenanceRecord.groupBy({ by: ["vehicleId"], where: { vehicleId: { in: ids }, status: "DONE", date: range(f) }, _sum: { cost: true } }),
    ctx.db.vehicleCompliance.groupBy({ by: ["vehicleId"], where: { vehicleId: { in: ids }, startDate: range(f) }, _sum: { cost: true } }),
    ctx.db.trafficFine.groupBy({ by: ["vehicleId"], where: { vehicleId: { in: ids }, status: { not: "CANCELLED" }, date: range(f) }, _sum: { amount: true } }),
  ]);
  return vehicles.map((v) => {
    const t = trips.find((x) => x.vehicleId === v.id);
    const logs = fuel.filter((x) => x.vehicleId === v.id);
    const fuelCost = logs.reduce((a, l) => a + d(l.amount).toNumber(), 0);
    const stats = fuelStats(logs.map((l) => ({ date: l.date, liters: d(l.liters).toNumber(), odometer: l.odometer, fullTank: l.fullTank })));
    const km = t?._sum.distanceKm ?? 0, revenue = d(t?._sum.revenue ?? 0).toNumber();
    const m = d(maint.find((x) => x.vehicleId === v.id)?._sum.cost ?? 0).toNumber(), c = d(comp.find((x) => x.vehicleId === v.id)?._sum.cost ?? 0).toNumber(), fi = d(fines.find((x) => x.vehicleId === v.id)?._sum.amount ?? 0).toNumber();
    const cost = fuelCost + m + c + fi;
    return {
      vehicleId: v.id, plate: v.plate, label: [v.brand, v.model].filter(Boolean).join(" ") || v.name || "", trips: t?._count._all ?? 0, km, revenue: round(revenue),
      fuel: round(fuelCost), liters: round(logs.reduce((a, l) => a + d(l.liters).toNumber(), 0)), per100: stats.per100, maintenance: round(m), compliance: round(c), fines: round(fi),
      cost: round(cost), margin: round(revenue - cost), costPerKm: km > 0 ? round(cost / km) : null,
    };
  });
}

// ═══ Points d'attention (alertes) ═════════════════════════════

export type AttentionKind = "insurance" | "inspection" | "registration" | "document" | "license" | "maintenance" | "fine" | "missing";
export interface AttentionItem { kind: AttentionKind; severity: "danger" | "warning"; label: string; date: Date | null; vehicleId?: string; driverId?: string; href: string }

const KIND_LABEL: Record<string, { kind: AttentionKind; label: string }> = {
  INSURANCE: { kind: "insurance", label: "Assurance" }, TECHNICAL_INSPECTION: { kind: "inspection", label: "Visite technique" }, REGISTRATION: { kind: "registration", label: "Carte grise" }, OTHER: { kind: "document", label: "Document" },
};
const fr = (dt: Date) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "UTC" }).format(dt);

/**
 * Ce qui demande une action dans la flotte : assurances, visites techniques et documents expirés ou expirant sous 30 jours,
 * permis des chauffeurs, entretiens à faire (planifiés, ou échéance atteinte en date ou en kilométrage), contraventions à payer sous 7 jours.
 * Utilisable avec `ctx.db` (écran) ou `platformDb` (tâche d'alertes) : l'entreprise est TOUJOURS explicite dans chaque requête.
 */
export async function fleetAttention(db: Db, companyId: string, today = todayUtc()): Promise<AttentionItem[]> {
  const soon = new Date(today.getTime() + 30 * DAY), maintSoon = new Date(today.getTime() + 15 * DAY), fineSoon = new Date(today.getTime() + 7 * DAY);
  const [vehicles, compliance, drivers, planned, lastDone, fines] = await Promise.all([
    db.vehicle.findMany({ where: { companyId, deletedAt: null, status: { not: "SOLD" } }, select: { id: true, plate: true, type: true, status: true, odometer: true } }),
    db.vehicleCompliance.findMany({ where: { companyId }, select: { vehicleId: true, kind: true, expiresAt: true }, take: 20_000 }),
    db.driver.findMany({ where: { companyId, deletedAt: null, status: "ACTIVE", licenseExpiry: { not: null, lte: soon } }, select: { id: true, fullName: true, licenseExpiry: true } }),
    db.maintenanceRecord.findMany({ where: { companyId, status: "PLANNED", date: { lte: maintSoon } }, select: { vehicleId: true, description: true, date: true } }),
    db.maintenanceRecord.findMany({ where: { companyId, status: "DONE", OR: [{ nextDueDate: { not: null } }, { nextDueKm: { not: null } }] }, orderBy: { date: "desc" }, select: { vehicleId: true, description: true, nextDueDate: true, nextDueKm: true, date: true }, take: 20_000 }),
    db.trafficFine.findMany({ where: { companyId, status: "TO_PAY", dueDate: { not: null, lte: fineSoon } }, select: { id: true, number: true, dueDate: true, amount: true, vehicleId: true } }),
  ]);
  const plate = new Map(vehicles.map((v) => [v.id, v.plate]));
  const items: AttentionItem[] = [];
  const vlink = (id: string) => `/app/fleet/vehicules/${id}`;

  for (const v of vehicles) {
    const recs = compliance.filter((c) => c.vehicleId === v.id);
    const road = (ROAD_TYPES as readonly string[]).includes(v.type) && v.status === "ACTIVE";
    for (const kind of ["INSURANCE", "TECHNICAL_INSPECTION", "REGISTRATION", "OTHER"] as const) {
      const hasKind = recs.some((r) => r.kind === kind);
      if (!hasKind) {
        if (road && kind !== "REGISTRATION" && kind !== "OTHER") items.push({ kind: "missing", severity: "warning", label: `${KIND_LABEL[kind]!.label} non renseignée — ${v.plate}`, date: null, vehicleId: v.id, href: vlink(v.id) });
        continue;
      }
      const s = complianceStatus(recs, kind, today);
      if (s.state === "EXPIRED") items.push({ kind: KIND_LABEL[kind]!.kind, severity: "danger", label: `${KIND_LABEL[kind]!.label} expirée le ${fr(s.expiresAt!)} — ${v.plate}`, date: s.expiresAt, vehicleId: v.id, href: vlink(v.id) });
      else if (s.state === "EXPIRING") items.push({ kind: KIND_LABEL[kind]!.kind, severity: "warning", label: `${KIND_LABEL[kind]!.label} expire le ${fr(s.expiresAt!)} — ${v.plate}`, date: s.expiresAt, vehicleId: v.id, href: vlink(v.id) });
    }
  }
  for (const dr of drivers) {
    const expired = dr.licenseExpiry! < today;
    items.push({ kind: "license", severity: expired ? "danger" : "warning", label: `Permis de ${dr.fullName} ${expired ? "expiré" : "expire"} le ${fr(dr.licenseExpiry!)}`, date: dr.licenseExpiry, driverId: dr.id, href: "/app/fleet/chauffeurs" });
  }
  const withPlanned = new Set(planned.filter((p) => plate.has(p.vehicleId)).map((p) => p.vehicleId));
  for (const p of planned) {
    if (!plate.has(p.vehicleId)) continue;
    items.push({ kind: "maintenance", severity: p.date < today ? "danger" : "warning", label: `Entretien ${p.date < today ? "en retard" : "à faire"} : ${p.description} — ${plate.get(p.vehicleId)} (${fr(p.date)})`, date: p.date, vehicleId: p.vehicleId, href: vlink(p.vehicleId) });
  }
  const seen = new Set<string>();
  for (const m of lastDone) {
    if (seen.has(m.vehicleId)) continue;
    seen.add(m.vehicleId); // le dernier entretien réalisé fixe la prochaine échéance
    const v = vehicles.find((x) => x.id === m.vehicleId);
    if (!v || withPlanned.has(v.id)) continue;
    const byDate = m.nextDueDate !== null && m.nextDueDate <= maintSoon, byKm = m.nextDueKm !== null && v.odometer + 500 >= m.nextDueKm;
    if (!byDate && !byKm) continue;
    const late = (m.nextDueDate !== null && m.nextDueDate < today) || (m.nextDueKm !== null && v.odometer >= m.nextDueKm);
    items.push({ kind: "maintenance", severity: late ? "danger" : "warning", label: `Entretien ${late ? "dépassé" : "bientôt dû"} : ${m.description} — ${v.plate}${byKm ? ` (échéance ${m.nextDueKm!.toLocaleString("fr-FR")} km, compteur ${v.odometer.toLocaleString("fr-FR")} km)` : ` (${fr(m.nextDueDate!)})`}`, date: m.nextDueDate, vehicleId: v.id, href: vlink(v.id) });
  }
  for (const f of fines) {
    items.push({ kind: "fine", severity: f.dueDate! < today ? "danger" : "warning", label: `PV ${f.number} à payer avant le ${fr(f.dueDate!)} — ${plate.get(f.vehicleId) ?? ""}`, date: f.dueDate, vehicleId: f.vehicleId, href: "/app/fleet/contraventions?statut=TO_PAY" });
  }
  return items.sort((a, b) => Number(b.severity === "danger") - Number(a.severity === "danger") || (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity));
}

// ═══ Lien avec Finance ════════════════════════════════════════

export type CostSource = "fuel" | "maintenance" | "fine";
const CATEGORY: Record<CostSource, string> = { fuel: "Transport et carburant", maintenance: "Entretien et réparations", fine: "Divers" };

/**
 * Crée dans Finance la dépense (brouillon) correspondant à un plein, un entretien réalisé ou une contravention, imputée à l'agence et au
 * centre de coûts du véhicule. L'enregistrement garde le lien : un coût n'est transformé qu'une fois et reste compté une seule fois en flotte.
 */
export async function createExpenseFromCost(ctx: Ctx, source: CostSource, id: string) {
  if (!ctx.hasModule("finance")) throw businessRule("Le module Finance n'est pas activé.");
  if (!ctx.can("finance.expense.create")) throw forbidden("La création de dépenses exige le droit « Dépenses — créer ».");
  const rec = source === "fuel" ? await ctx.db.fuelLog.findFirst({ where: { id }, include: { vehicle: true } })
    : source === "maintenance" ? await ctx.db.maintenanceRecord.findFirst({ where: { id }, include: { vehicle: true } })
    : await ctx.db.trafficFine.findFirst({ where: { id }, include: { vehicle: true } });
  if (!rec) throw notFound(source === "fuel" ? "Plein" : source === "maintenance" ? "Entretien" : "Contravention");
  if (rec.expenseId) throw businessRule("Une dépense existe déjà pour cet enregistrement.");
  const amount = source === "fuel" ? d((rec as { amount: Numeric }).amount) : source === "maintenance" ? d((rec as { cost: Numeric }).cost) : d((rec as { amount: Numeric }).amount);
  if (amount.lte(0)) throw businessRule("Le montant est nul : rien à enregistrer en dépense.");
  if (source === "maintenance" && (rec as { status: string }).status !== "DONE") throw businessRule("Seul un entretien réalisé peut être enregistré en dépense.");
  if (source === "fine" && (rec as { status: string }).status === "CANCELLED") throw businessRule("Cette contravention est annulée.");
  const category = (await ctx.db.financeCategory.findFirst({ where: { name: CATEGORY[source], kind: "EXPENSE" } })) ?? (await ctx.db.financeCategory.findFirst({ where: { kind: "EXPENSE" }, orderBy: { name: "asc" } }));
  if (!category) throw businessRule("Aucune catégorie de dépense n'est définie dans Finance.");
  const plate = rec.vehicle.plate;
  const date = source === "fuel" ? (rec as { date: Date }).date : (rec as { date: Date }).date;
  const description = source === "fuel" ? `Carburant ${plate} — ${d((rec as { liters: Numeric }).liters).toNumber()} L` : source === "maintenance" ? `Entretien ${plate} — ${(rec as { description: string }).description}` : `Contravention ${(rec as { number: string }).number} — ${plate} (${(rec as { offence: string }).offence})`;
  const exp = await expenses.createExpense(ctx, expenseSchema.parse({ date: date.toISOString().slice(0, 10), categoryId: category.id, description: description.slice(0, 250), amount: amount.toNumber(), method: "CASH", branchId: rec.vehicle.branchId ?? "", costCenterId: rec.vehicle.costCenterId ?? "", supplierId: source === "maintenance" ? (rec as { supplierId: string | null }).supplierId ?? "" : "" }));
  const model = source === "fuel" ? ctx.db.fuelLog : source === "maintenance" ? ctx.db.maintenanceRecord : ctx.db.trafficFine;
  const claim = await (model as unknown as { updateMany: (a: unknown) => Promise<{ count: number }> }).updateMany({ where: { id, expenseId: null }, data: { expenseId: exp.id } });
  if (claim.count !== 1) { await expenses.deleteExpense(ctx, exp.id); throw businessRule("Une dépense vient d'être créée pour cet enregistrement."); }
  await audit(ctx, { action: "fleet.expense.create", resource: "Expense", resourceId: exp.id, summary: `${ctx.user.name} a créé la dépense ${exp.number} (${formatMoney(amount.toNumber(), ctx.company.currency)}) à partir d'un coût de la flotte (${plate}).` });
  return exp;
}
