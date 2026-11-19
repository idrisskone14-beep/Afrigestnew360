import "server-only";
import type { z } from "zod";
import { audit } from "@/core/audit";
import { businessRule, forbidden, notFound } from "@/core/errors";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import { loadPolicy } from "./policy";
import type { accidentSchema, updateAccidentSchema } from "./registers-schemas";
import { ACCIDENT_SCOPE, assertCan, assertInScope, employeeFilter, scopeOf } from "./scope";
import { dayOf, parseDay } from "./time";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const iso = (v: Date) => v.toISOString().slice(0, 10);
const fr = (v: Date) => v.toLocaleDateString("fr-FR", { timeZone: "UTC" });

// ═══ Complétude du dossier ════════════════════════════════════

export interface AccidentLike {
  kind: string; circumstances: string; injuries: string | null; firstAid: string | null; workStop: boolean; stopStart: Date | null; stopEnd: Date | null; returnDate: Date | null;
  cnpsStatus: string; cnpsDeclaredOn: Date | null; cnpsReference: string | null; qualification: string; commuteDetails: string | null; correctiveActions: string | null; occurredOn: Date; status: string;
}
export interface Gap { code: string; message: string; /** Bloque la clôture du dossier. */ blocking: boolean }

/**
 * Éléments manquants d'un dossier (fonction pure). `declarationDays` : délai paramétré par l'entreprise pour déclarer à la CNPS (null = pas d'alerte de délai).
 * Aucun délai réglementaire n'est présumé ici : voir « Paramètres RH ».
 */
export function accidentGaps(a: AccidentLike, today: Date, declarationDays: number | null): Gap[] {
  const gaps: Gap[] = [];
  const add = (code: string, message: string, blocking = true) => gaps.push({ code, message, blocking });
  if (!a.injuries) add("injuries", "Nature des blessures non renseignée");
  if (!a.firstAid) add("first_aid", "Premiers soins non renseignés", false);
  if (a.workStop && !a.stopStart) add("stop_start", "Arrêt de travail sans date de début");
  if (a.workStop && a.stopEnd && a.stopEnd < dayOf(today) && !a.returnDate) add("return", "Arrêt terminé : date de reprise non renseignée");
  if (a.cnpsStatus === "TO_DECLARE") {
    add("cnps", "Déclaration CNPS à effectuer");
    if (declarationDays != null) {
      const elapsed = Math.floor((dayOf(today).getTime() - a.occurredOn.getTime()) / 86_400_000);
      if (elapsed > declarationDays) add("cnps_late", `Délai de déclaration paramétré (${declarationDays} j) dépassé de ${elapsed - declarationDays} j`);
    }
  }
  if ((a.cnpsStatus === "DECLARED" || a.cnpsStatus === "ACKNOWLEDGED") && !a.cnpsReference) add("cnps_ref", "Référence de déclaration CNPS manquante");
  if (a.kind === "COMMUTE") {
    if (!a.commuteDetails) add("commute", "Itinéraire et circonstances du trajet non renseignés");
    if (a.qualification === "TO_QUALIFY") add("qualification", "Qualification de l'accident de trajet en attente de décision", false);
  }
  if (!a.correctiveActions) add("corrective", "Mesures correctives non renseignées", false);
  return gaps;
}

// ═══ Lecture ══════════════════════════════════════════════════

export interface AccidentFilters { q?: string; status?: string; kind?: string; cnps?: string; employeeId?: string; year?: number; skip: number; take: number }

export async function listAccidents(ctx: Ctx, p: AccidentFilters) {
  assertCan(ctx, "hr.accident.read");
  const scope = await scopeOf(ctx, ACCIDENT_SCOPE);
  const where = {
    ...employeeFilter(scope),
    ...(p.status ? { status: p.status as never } : { status: { not: "ARCHIVED" as const } }),
    ...(p.kind ? { kind: p.kind as never } : {}),
    ...(p.cnps ? { cnpsStatus: p.cnps as never } : {}),
    ...(p.employeeId ? { employeeId: p.employeeId } : {}),
    ...(p.year ? { occurredOn: { gte: new Date(Date.UTC(p.year, 0, 1)), lte: new Date(Date.UTC(p.year, 11, 31)) } } : {}),
    ...(p.q ? { OR: ["number", "employeeName", "employeeNumber", "place", "category"].map((f) => ({ [f]: { contains: p.q, mode: "insensitive" as const } })) } : {}),
  };
  const [total, rows, policy] = await Promise.all([
    ctx.db.workAccident.count({ where }),
    ctx.db.workAccident.findMany({ where, orderBy: [{ occurredOn: "desc" }, { number: "desc" }], skip: p.skip, take: p.take }),
    loadPolicy(ctx.db),
  ]);
  const today = new Date();
  return { total, rows: rows.map((r) => ({ ...r, gaps: r.status === "ARCHIVED" ? [] : accidentGaps(r, today, policy.accidentDeclarationDays) })) };
}

export async function getAccident(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.accident.read");
  const a = await ctx.db.workAccident.findFirst({ where: { id } });
  if (!a) throw notFound("Dossier d'accident");
  assertInScope(await scopeOf(ctx, ACCIDENT_SCOPE), a.employeeId, "Dossier d'accident");
  const policy = await loadPolicy(ctx.db);
  const [history, documents] = await Promise.all([
    ctx.db.auditLog.findMany({ where: { resource: "WorkAccident", resourceId: id }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, action: true, summary: true, userLabel: true, createdAt: true } }),
    ctx.db.documentLink.count({ where: { entityType: "hr_accident", entityId: id } }),
  ]);
  return { ...a, gaps: a.status === "ARCHIVED" ? [] : accidentGaps(a, new Date(), policy.accidentDeclarationDays), history, documentCount: documents };
}

/** Consultation d'une fiche sensible : tracée (qui a consulté quoi, quand). */
export async function logAccidentView(ctx: Ctx, a: { id: string; number: string }) {
  await audit(ctx, { action: "hr.accident.view", resource: "WorkAccident", resourceId: a.id, summary: `${ctx.user.name} a consulté le dossier d'accident ${a.number}.` });
}

// ═══ Écriture ═════════════════════════════════════════════════

type AccidentInput = Omit<z.output<typeof accidentSchema>, "employeeId">;

/** Dates et statuts cohérents ; retourne les valeurs normalisées prêtes à stocker. */
function normalize(input: AccidentInput, today: Date) {
  const occurredOn = parseDay(input.occurredOn);
  if (!occurredOn) throw businessRule("Date de l'accident invalide.");
  if (occurredOn > dayOf(today)) throw businessRule("La date de l'accident ne peut pas être dans le futur.");
  const date = (v: string | undefined, label: string) => { if (!v) return null; const d = parseDay(v); if (!d) throw businessRule(`${label} invalide.`); return d; };
  const stopStart = input.workStop ? date(input.stopStart, "Date de début d'arrêt") : null;
  const stopEnd = input.workStop ? date(input.stopEnd, "Date de fin d'arrêt") : null;
  const returnDate = date(input.returnDate, "Date de reprise");
  const cnpsDeclaredOn = date(input.cnpsDeclaredOn, "Date de déclaration CNPS");
  if (stopStart && stopStart < occurredOn) throw businessRule("L'arrêt de travail ne peut pas commencer avant l'accident.");
  if (stopStart && stopEnd && stopEnd < stopStart) throw businessRule("La fin de l'arrêt précède son début.");
  if (returnDate && returnDate < occurredOn) throw businessRule("La reprise précède l'accident.");
  if (returnDate && stopStart && returnDate < stopStart) throw businessRule("La reprise précède le début de l'arrêt.");
  if (cnpsDeclaredOn && cnpsDeclaredOn < occurredOn) throw businessRule("La déclaration CNPS précède l'accident.");
  if ((input.cnpsStatus === "DECLARED" || input.cnpsStatus === "ACKNOWLEDGED") && !cnpsDeclaredOn) throw businessRule("Indiquez la date de déclaration à la CNPS.");
  return {
    kind: input.kind, occurredOn, occurredTime: blank(input.occurredTime), place: input.place.trim(), category: blank(input.category), circumstances: input.circumstances.trim(),
    injuries: blank(input.injuries), witnesses: blank(input.witnesses), firstAid: blank(input.firstAid), careFacility: blank(input.careFacility), commuteDetails: blank(input.commuteDetails),
    workStop: input.workStop, stopStart, stopEnd, returnDate, cnpsStatus: input.cnpsStatus, cnpsDeclaredOn, cnpsReference: blank(input.cnpsReference),
    qualification: input.qualification, correctiveActions: blank(input.correctiveActions),
  };
}

export async function createAccident(ctx: Ctx, input: z.output<typeof accidentSchema>) {
  assertCan(ctx, "hr.accident.manage");
  const emp = await ctx.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null }, include: { department: { select: { name: true } } } });
  if (!emp) throw notFound("Salarié");
  const data = normalize(input, new Date());
  if (emp.hireDate > data.occurredOn) throw businessRule("L'accident précède la date d'embauche du salarié.");
  const created = await ctx.tx(async (tx) => {
    const number = await nextNumber(tx, ctx.company.id, "work_accident", data.occurredOn);
    const a = await tx.workAccident.create({
      data: { ...data, companyId: ctx.company.id, number, employeeId: emp.id, employeeNumber: emp.number, employeeName: `${emp.lastName} ${emp.firstName}`, departmentName: emp.department?.name ?? null, createdById: ctx.user.id },
    });
    await audit(ctx, { action: "hr.accident.create", resource: "WorkAccident", resourceId: a.id, summary: `${ctx.user.name} a ouvert le dossier d'accident ${a.number} pour ${a.employeeName} (${fr(a.occurredOn)}).`, after: { kind: a.kind, occurredOn: iso(a.occurredOn) } }, tx);
    return a;
  });
  return created;
}

const SNAPSHOT_FIELDS = ["kind", "place", "category", "workStop", "cnpsStatus", "cnpsReference", "qualification", "status"] as const;

export async function updateAccident(ctx: Ctx, input: z.output<typeof updateAccidentSchema>) {
  assertCan(ctx, "hr.accident.manage");
  const before = await ctx.db.workAccident.findFirst({ where: { id: input.id } });
  if (!before) throw notFound("Dossier d'accident");
  if (before.status !== "OPEN") throw businessRule(before.status === "CLOSED" ? "Ce dossier est clos : rouvrez-le avant de le modifier." : "Ce dossier est archivé et n'est plus modifiable.");
  const { id: _id, ...rest } = input;
  void _id;
  const data = normalize(rest, new Date());
  if (await ctx.db.employee.findFirst({ where: { id: before.employeeId, hireDate: { gt: data.occurredOn } }, select: { id: true } })) throw businessRule("L'accident précède la date d'embauche du salarié.");
  const after = await ctx.db.workAccident.update({ where: { id: before.id }, data });
  const changed = SNAPSHOT_FIELDS.filter((f) => String(before[f]) !== String(after[f]));
  await audit(ctx, { action: "hr.accident.update", resource: "WorkAccident", resourceId: before.id, summary: `${ctx.user.name} a modifié le dossier d'accident ${before.number}${changed.length ? ` (${changed.join(", ")})` : ""}.`, before: Object.fromEntries(changed.map((f) => [f, before[f]])), after: Object.fromEntries(changed.map((f) => [f, after[f]])) });
  return after;
}

export async function closeAccident(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.accident.manage");
  const a = await ctx.db.workAccident.findFirst({ where: { id } });
  if (!a) throw notFound("Dossier d'accident");
  if (a.status !== "OPEN") throw businessRule("Seul un dossier ouvert peut être clos.");
  const blocking = accidentGaps(a, new Date(), null).filter((g) => g.blocking && g.code !== "cnps_late");
  if (blocking.length) throw businessRule(`Dossier incomplet : ${blocking.map((g) => g.message).join(" ; ")}.`);
  await ctx.db.workAccident.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date() } });
  await audit(ctx, { action: "hr.accident.close", resource: "WorkAccident", resourceId: id, summary: `${ctx.user.name} a clos le dossier d'accident ${a.number}.` });
}

export async function reopenAccident(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.accident.manage");
  const a = await ctx.db.workAccident.findFirst({ where: { id } });
  if (!a) throw notFound("Dossier d'accident");
  if (a.status !== "CLOSED") throw businessRule(a.status === "ARCHIVED" ? "Désarchivez le dossier avant de le rouvrir." : "Ce dossier est déjà ouvert.");
  await ctx.db.workAccident.update({ where: { id }, data: { status: "OPEN", closedAt: null } });
  await audit(ctx, { action: "hr.accident.reopen", resource: "WorkAccident", resourceId: id, summary: `${ctx.user.name} a rouvert le dossier d'accident ${a.number}.` });
}

/** Archivage contrôlé : uniquement un dossier clos ; aucun dossier n'est jamais supprimé (obligations de conservation). */
export async function archiveAccident(ctx: Ctx, id: string, archived: boolean) {
  assertCan(ctx, "hr.accident.manage");
  const a = await ctx.db.workAccident.findFirst({ where: { id } });
  if (!a) throw notFound("Dossier d'accident");
  if (archived && a.status !== "CLOSED") throw businessRule("Clôturez le dossier avant de l'archiver.");
  if (!archived && a.status !== "ARCHIVED") throw businessRule("Ce dossier n'est pas archivé.");
  await ctx.db.workAccident.update({ where: { id }, data: archived ? { status: "ARCHIVED", archivedAt: new Date() } : { status: "CLOSED", archivedAt: null } });
  await audit(ctx, { action: archived ? "hr.accident.archive" : "hr.accident.unarchive", resource: "WorkAccident", resourceId: id, summary: `${ctx.user.name} a ${archived ? "archivé" : "désarchivé"} le dossier d'accident ${a.number}.` });
}

// ═══ Tableau de bord ══════════════════════════════════════════

export async function accidentDashboard(ctx: Ctx, year: number) {
  assertCan(ctx, "hr.accident.read");
  const scope = await scopeOf(ctx, ACCIDENT_SCOPE);
  if (scope.kind === "none") throw forbidden();
  const rows = await ctx.db.workAccident.findMany({
    where: { ...employeeFilter(scope), occurredOn: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } },
    select: { id: true, kind: true, circumstances: true, status: true, occurredOn: true, workStop: true, stopStart: true, stopEnd: true, cnpsStatus: true, injuries: true, firstAid: true, returnDate: true, cnpsDeclaredOn: true, cnpsReference: true, qualification: true, commuteDetails: true, correctiveActions: true },
  });
  const policy = await loadPolicy(ctx.db);
  const today = new Date();
  const byMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: 0 }));
  const byKind: Record<string, number> = { WORKPLACE: 0, COMMUTE: 0, MISSION: 0 };
  let stopDays = 0, toDeclare = 0, incomplete = 0, open = 0, withStop = 0;
  for (const r of rows) {
    byMonth[r.occurredOn.getUTCMonth()]!.count++;
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    if (r.status === "OPEN") open++;
    if (r.workStop) { withStop++; if (r.stopStart) stopDays += Math.floor(((r.stopEnd ?? dayOf(today)).getTime() - r.stopStart.getTime()) / 86_400_000) + 1; }
    if (r.cnpsStatus === "TO_DECLARE") toDeclare++;
    if (r.status !== "ARCHIVED" && accidentGaps(r, today, policy.accidentDeclarationDays).some((g) => g.blocking)) incomplete++;
  }
  return { year, total: rows.length, open, withStop, stopDays, toDeclare, incomplete, byMonth, byKind };
}
