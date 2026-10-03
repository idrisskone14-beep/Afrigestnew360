import "server-only";
import { audit } from "@/core/audit";
import { Prisma } from "@/core/db/client";
import { AppError, businessRule, forbidden, notFound } from "@/core/errors";
import type { TenantContext } from "@/core/tenant/context";
import { ENTITIES, fieldsFor, isImportEntity, suggestMapping, type EntityDef, type FieldDef, type Prepared } from "./entities";
import { IMPORT_MAX_ROWS, parseTable } from "./parse";

type Ctx = TenantContext;

/** Nombre maximal d'anomalies conservées dans le rapport (les compteurs, eux, restent exacts). */
const REPORT_MAX = 1000;
const PREVIEW_ROWS = 25;

export interface ReportEntry { line: number; kind: "error" | "ignored"; message: string; values: string[] }
export type Mapping = Record<string, number>;

interface RowResult { line: number; raw: string[]; status: "ok" | "error" | "ignored"; messages: string[]; prepared?: Prepared; values: Record<string, string> }

function definition(ctx: Ctx, entity: string): EntityDef {
  if (!isImportEntity(entity)) throw notFound("Type de données");
  const def = ENTITIES[entity];
  ctx.assertCan("data.import.manage");
  ctx.assertModule(def.module);
  ctx.assertCan(def.permission);
  return def;
}

async function loadJob(ctx: Ctx, id: string) {
  const job = await ctx.db.importJob.findFirst({ where: { id } });
  if (!job) throw notFound("Import");
  return job;
}

/** Colonnes (indices) → valeurs par champ pour une ligne du fichier. */
const valuesOf = (raw: string[], mapping: Mapping) => Object.fromEntries(Object.entries(mapping).map(([field, i]) => [field, raw[i] ?? ""]));

/**
 * Analyse chaque ligne : valeurs converties et validées (schémas du service métier), doublons dans le fichier,
 * lignes déjà présentes en base (ignorées). Aucune écriture : sert à la prévisualisation ET à l'import (relu au dernier moment).
 */
async function evaluate(ctx: Ctx, def: EntityDef, rows: string[][], mapping: Mapping): Promise<RowResult[]> {
  const lookups = await def.loadLookups(ctx);
  const seen = new Map<string, number>();
  return rows.map((raw, i): RowResult => {
    const line = i + 2; // la ligne 1 contient les en-têtes
    const values = valuesOf(raw, mapping);
    const prepared = def.prepare(ctx, values, lookups);
    if (prepared.errors.length > 0 || prepared.input === undefined) return { line, raw, status: "error", messages: prepared.errors.length ? prepared.errors : ["Ligne invalide."], values };
    const first = seen.get(prepared.identity);
    if (first !== undefined) return { line, raw, status: "error", messages: [`Doublon dans le fichier (identique à la ligne ${first}).`], values };
    seen.set(prepared.identity, line);
    if (def.exists(lookups, prepared)) return { line, raw, status: "ignored", messages: ["Existe déjà : ignorée."], prepared, values };
    return { line, raw, status: "ok", messages: [], prepared, values };
  });
}

const countOf = (r: RowResult[], s: RowResult["status"]) => r.filter((x) => x.status === s).length;
const reportOf = (r: RowResult[]): ReportEntry[] => r.filter((x) => x.status !== "ok").slice(0, REPORT_MAX).map((x) => ({ line: x.line, kind: x.status === "error" ? "error" : "ignored", message: x.messages.join(" ; "), values: x.raw }));

// ── Étape 1 : analyse du fichier ──────────────────────────────

/** Lit le fichier (format vérifié sur les octets), propose une correspondance de colonnes et conserve les lignes le temps de l'import. */
export async function analyzeImport(ctx: Ctx, entity: string, file: { name: string; size: number }, data: Buffer) {
  const def = definition(ctx, entity);
  const t = await parseTable(data, file.name);
  const fields = fieldsFor(ctx, def);
  const job = await ctx.db.importJob.create({
    data: { companyId: ctx.company.id, entity: def.key, fileName: file.name.replace(/^.*[\\/]/, "").slice(0, 150), headers: t.headers, rows: t.rows, rowCount: t.rows.length, createdById: ctx.user.id },
  });
  await audit(ctx, { action: "import.upload", resource: "ImportJob", resourceId: job.id, summary: `${ctx.user.name} a chargé un fichier d'import « ${def.label} » (${job.fileName}, ${t.rows.length} ligne${t.rows.length > 1 ? "s" : ""}).` });
  return { id: job.id, entity: def.key, headers: t.headers, rowCount: t.rows.length, sample: t.rows.slice(0, 5), suggested: suggestMapping(t.headers, fields), fields: fields.map(({ key, label, required, hint }) => ({ key, label, required: Boolean(required), hint })) };
}

// ── Étape 2 : correspondance + prévisualisation ───────────────

function checkMapping(def: EntityDef, fields: FieldDef[], mapping: Mapping, columns: number) {
  const allowed = new Set(fields.map((f) => f.key));
  const used = new Set<number>();
  for (const [field, idx] of Object.entries(mapping)) {
    if (!allowed.has(field)) throw businessRule(`Champ inconnu : ${field}.`);
    if (!Number.isInteger(idx) || idx < 0 || idx >= columns) throw businessRule("Colonne inexistante dans le fichier.");
    if (used.has(idx)) throw businessRule("Une même colonne ne peut alimenter qu'un seul champ.");
    used.add(idx);
  }
  const missing = fields.filter((f) => f.required && mapping[f.key] === undefined);
  if (missing.length > 0) throw businessRule(`Champ${missing.length > 1 ? "s" : ""} obligatoire${missing.length > 1 ? "s" : ""} sans colonne : ${missing.map((f) => f.label).join(", ")}.`);
  void def;
}

export async function previewImport(ctx: Ctx, id: string, mapping: Mapping) {
  const job = await loadJob(ctx, id);
  const def = definition(ctx, job.entity);
  if (job.status !== "UPLOADED" && job.status !== "VALIDATED") throw businessRule("Cet import n'est plus modifiable.");
  const headers = job.headers as string[];
  checkMapping(def, fieldsFor(ctx, def), mapping, headers.length);
  const rows = job.rows as string[][] | null;
  if (!rows) throw businessRule("Les lignes de ce fichier ne sont plus disponibles : rechargez le fichier.");
  const results = await evaluate(ctx, def, rows, mapping);
  const counts = { valid: countOf(results, "ok"), errors: countOf(results, "error"), ignored: countOf(results, "ignored") };
  await ctx.db.importJob.update({ where: { id }, data: { status: "VALIDATED", mapping, validCount: counts.valid, errorCount: counts.errors, ignoredCount: counts.ignored, report: reportOf(results) as never } });
  return {
    id, ...counts, total: rows.length,
    preview: results.slice(0, PREVIEW_ROWS).map((r) => ({ line: r.line, status: r.status, messages: r.messages, values: r.values })),
    previewMore: Math.max(0, results.length - PREVIEW_ROWS),
  };
}

// ── Étape 3 : import ──────────────────────────────────────────

/**
 * Importe les lignes valides une à une par les SERVICES métier (numérotation, limites du plan, audit, événements) :
 * une ligne en échec n'empêche pas les suivantes. Les données sont re-validées au dernier moment (la base a pu changer depuis la
 * prévisualisation) et l'import ne peut être lancé qu'une fois (réservation atomique du statut).
 */
export async function runImport(ctx: Ctx, id: string) {
  const job = await loadJob(ctx, id);
  const def = definition(ctx, job.entity);
  if (job.status !== "VALIDATED" || !job.mapping) throw businessRule(job.status === "RUNNING" ? "Cet import est déjà en cours." : job.status === "DONE" ? "Cet import est déjà terminé." : "Prévisualisez l'import avant de le lancer.");
  const claim = await ctx.db.importJob.updateMany({ where: { id, status: "VALIDATED" }, data: { status: "RUNNING" } });
  if (claim.count !== 1) throw businessRule("Cet import est déjà en cours ou terminé.");

  try {
    const results = await evaluate(ctx, def, job.rows as string[][], job.mapping as Mapping);
    const failures: ReportEntry[] = [];
    let created = 0, failed = 0, limit: string | null = null;
    for (const r of results) {
      if (r.status !== "ok") continue;
      if (limit) { failed++; failures.push({ line: r.line, kind: "error", message: limit, values: r.raw }); continue; }
      try {
        await def.create(ctx, r.prepared!.input as never);
        created++;
      } catch (e) {
        failed++;
        const msg = e instanceof AppError ? e.message : "Erreur inattendue lors de l'enregistrement.";
        if (!(e instanceof AppError)) console.error("[import]", id, r.line, e);
        if (e instanceof AppError && e.code === "LIMIT_REACHED") limit = msg;
        failures.push({ line: r.line, kind: "error", message: msg, values: r.raw });
      }
    }
    const report = [...reportOf(results), ...failures].slice(0, REPORT_MAX);
    // les lignes brutes (données personnelles) ne sont plus nécessaires : purgées en même temps que le statut final
    const final = await ctx.db.importJob.update({
      where: { id },
      data: { status: "DONE", rows: Prisma.DbNull, createdCount: created, failedCount: failed, errorCount: countOf(results, "error"), ignoredCount: countOf(results, "ignored"), validCount: created, report: report as never, completedAt: new Date() },
    });
    await audit(ctx, { action: "import.run", resource: "ImportJob", resourceId: id, summary: `${ctx.user.name} a importé « ${def.label} » : ${created} créé${created > 1 ? "s" : ""}, ${final.ignoredCount} ignoré${final.ignoredCount > 1 ? "s" : ""}, ${final.errorCount + failed} en erreur.`, after: { created, failed, ignored: final.ignoredCount, errors: final.errorCount, file: job.fileName } });
    return { id, created, ignored: final.ignoredCount, errors: final.errorCount, failed };
  } catch (e) {
    await ctx.db.importJob.updateMany({ where: { id, status: "RUNNING" }, data: { status: "FAILED", completedAt: new Date() } });
    throw e;
  }
}

/** Abandonne un import non terminé (supprime le fichier chargé) ou supprime l'historique d'un import terminé. */
export async function discardImport(ctx: Ctx, id: string) {
  const job = await loadJob(ctx, id);
  definition(ctx, job.entity);
  if (job.status === "RUNNING") throw businessRule("Cet import est en cours.");
  await ctx.db.importJob.delete({ where: { id } });
  await audit(ctx, { action: "import.discard", resource: "ImportJob", resourceId: id, summary: `${ctx.user.name} a supprimé l'import « ${job.fileName} ».` });
}

// ── Historique ────────────────────────────────────────────────

export async function listImports(ctx: Ctx) {
  if (!ctx.can("data.import.manage")) throw forbidden();
  return ctx.db.importJob.findMany({ orderBy: { createdAt: "desc" }, take: 30, select: { id: true, entity: true, fileName: true, status: true, rowCount: true, createdCount: true, ignoredCount: true, errorCount: true, failedCount: true, createdAt: true, completedAt: true } });
}

export async function importReport(ctx: Ctx, id: string) {
  const job = await loadJob(ctx, id);
  definition(ctx, job.entity);
  return { job, entries: (job.report as ReportEntry[] | null) ?? [], headers: job.headers as string[] };
}

export const IMPORT_LIMITS = { rows: IMPORT_MAX_ROWS };
