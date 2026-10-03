import "server-only";
import type { TenantContext } from "@/core/tenant/context";

type Ctx = TenantContext;

export interface AuditFilters { q?: string; userId?: string; resource?: string; action?: string; from?: Date; to?: Date }

/** Filtre Prisma commun à la liste et à l'export. Le journal est borné à l'entreprise par `ctx.db` (filtre + RLS). */
function where(f: AuditFilters) {
  return {
    ...(f.userId ? { userId: f.userId } : {}),
    ...(f.resource ? { resource: f.resource } : {}),
    ...(f.action ? { action: { startsWith: f.action } } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(f.q ? { OR: [{ summary: { contains: f.q, mode: "insensitive" as const } }, { resourceId: { equals: f.q } }, { userLabel: { contains: f.q, mode: "insensitive" as const } }] } : {}),
  };
}

export async function listAudit(ctx: Ctx, f: AuditFilters, p: { skip: number; take: number }) {
  ctx.assertCan("audit.log.read");
  const w = where(f);
  const [total, rows] = await Promise.all([
    ctx.db.auditLog.count({ where: w }),
    ctx.db.auditLog.findMany({ where: w, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take, select: { id: true, createdAt: true, userId: true, userLabel: true, action: true, resource: true, resourceId: true, summary: true, ip: true, userAgent: true, before: true, after: true } }),
  ]);
  return { total, rows };
}

export async function getAudit(ctx: Ctx, id: string) {
  ctx.assertCan("audit.log.read");
  return ctx.db.auditLog.findFirst({ where: { id } });
}

/** Valeurs distinctes pour les filtres (ressources, utilisateurs). */
export async function auditFacets(ctx: Ctx) {
  ctx.assertCan("audit.log.read");
  const [resources, users] = await Promise.all([
    ctx.db.auditLog.findMany({ distinct: ["resource"], select: { resource: true }, orderBy: { resource: "asc" }, take: 200 }),
    ctx.db.auditLog.findMany({ distinct: ["userId"], where: { userId: { not: null } }, select: { userId: true, userLabel: true }, take: 200 }),
  ]);
  return { resources: resources.map((r) => r.resource), users: users.map((u) => ({ id: u.userId!, label: u.userLabel ?? "Utilisateur" })).sort((a, b) => a.label.localeCompare(b.label, "fr")) };
}

/** Lignes d'export (le plus récent d'abord), plafonnées pour protéger le serveur. */
export const AUDIT_EXPORT_MAX = 10_000;
export async function auditForExport(ctx: Ctx, f: AuditFilters) {
  ctx.assertCan("audit.log.read");
  return ctx.db.auditLog.findMany({ where: where(f), orderBy: { createdAt: "desc" }, take: AUDIT_EXPORT_MAX, select: { createdAt: true, userLabel: true, action: true, resource: true, resourceId: true, summary: true, ip: true, userAgent: true } });
}
