import "server-only";
import { headers } from "next/headers";
import { platformDb, type Db } from "@/core/db/client";
import type { TenantContext } from "@/core/tenant/context";

const SENSITIVE_KEY = /pass(word)?|hash|secret|token|totp|recovery/i;

/** Retire les champs sensibles et sérialise en JSON stockable. */
export function sanitizeForAudit(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  return JSON.parse(
    JSON.stringify(value, (key, v) => {
      if (key && SENSITIVE_KEY.test(key)) return "[masqué]";
      if (typeof v === "bigint") return v.toString();
      return v;
    }),
  );
}

export interface AuditEntry {
  /** ex. "invoice.update" */
  action: string;
  /** ex. "Invoice" */
  resource: string;
  resourceId?: string | null;
  /** Phrase lisible : « Idrissa a modifié la facture FAC-2026-00123. » */
  summary: string;
  before?: unknown;
  after?: unknown;
}

async function requestMeta() {
  try {
    const h = await headers();
    return {
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/** Journalise une action dans le contexte d'une entreprise (append-only). */
export async function audit(ctx: Pick<TenantContext, "db" | "company" | "user">, entry: AuditEntry, db?: Db) {
  const meta = await requestMeta();
  await (db ?? ctx.db).auditLog.create({
    data: {
      companyId: ctx.company.id,
      userId: ctx.user.id,
      userLabel: ctx.user.name,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      summary: entry.summary,
      before: sanitizeForAudit(entry.before) as never,
      after: sanitizeForAudit(entry.after) as never,
      ...meta,
    },
  });
}

/** Journalise une action de plateforme (Super Admin) ; `companyId` = entreprise concernée si pertinent. */
export async function auditPlatform(
  actor: { id: string; name: string },
  entry: AuditEntry & { companyId?: string | null },
) {
  const meta = await requestMeta();
  await platformDb.auditLog.create({
    data: {
      companyId: entry.companyId ?? null,
      userId: actor.id,
      userLabel: `${actor.name} (plateforme)`,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      summary: entry.summary,
      before: sanitizeForAudit(entry.before) as never,
      after: sanitizeForAudit(entry.after) as never,
      ...meta,
    },
  });
}
