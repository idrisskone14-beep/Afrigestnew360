import "server-only";
import { forbidden, notFound } from "@/core/errors";
import type { TenantContext } from "@/core/tenant/context";

type Ctx = TenantContext;

/**
 * Portée des données d'un registre RH : qui voit les enregistrements de quels salariés.
 *  - « all »  : droits `read` ou `manage` du registre (RH, direction) → tous les salariés de l'entreprise ;
 *  - « team » : droit `approve` → ses collaborateurs directs et indirects (hiérarchie `managerId`) ET soi-même ;
 *  - « own »  : droit `request` (ou soi-même) → ses propres enregistrements ;
 *  - « none » : aucun accès.
 * L'isolation entre entreprises est assurée en amont (RLS) ; ceci borne l'accès DANS l'entreprise.
 */
export type Scope = { kind: "all" } | { kind: "ids"; ids: string[] } | { kind: "none" };

export interface ScopeKeys { all: string[]; team?: string; own?: string }

/** Collaborateurs (directs et indirects) d'un salarié, jusqu'à 10 niveaux ; protège contre une boucle hiérarchique. */
export async function teamOf(ctx: Ctx, managerEmployeeId: string): Promise<string[]> {
  const seen = new Set<string>([managerEmployeeId]);
  let frontier = [managerEmployeeId];
  for (let depth = 0; depth < 10 && frontier.length; depth++) {
    const rows = await ctx.db.employee.findMany({ where: { managerId: { in: frontier }, deletedAt: null }, select: { id: true } });
    frontier = rows.map((r) => r.id).filter((id) => !seen.has(id));
    for (const id of frontier) seen.add(id);
  }
  seen.delete(managerEmployeeId);
  return [...seen];
}

export async function scopeOf(ctx: Ctx, keys: ScopeKeys): Promise<Scope> {
  if (keys.all.some((k) => ctx.can(k))) return { kind: "all" };
  const wantsTeam = keys.team ? ctx.can(keys.team) : false;
  const wantsOwn = keys.own ? ctx.can(keys.own) : false;
  if (!wantsTeam && !wantsOwn) return { kind: "none" };
  const me = await ctx.db.employee.findFirst({ where: { userId: ctx.user.id, deletedAt: null }, select: { id: true } });
  if (!me) return { kind: "none" };
  const ids = wantsTeam ? [me.id, ...(await teamOf(ctx, me.id))] : [me.id];
  return { kind: "ids", ids };
}

/** Filtre Prisma sur `employeeId` ; `none` ne retourne rien. */
export const employeeFilter = (s: Scope): { employeeId?: { in: string[] } } => (s.kind === "all" ? {} : { employeeId: { in: s.kind === "ids" ? s.ids : [] } });

export const canSeeEmployee = (s: Scope, employeeId: string) => s.kind === "all" || (s.kind === "ids" && s.ids.includes(employeeId));

/** Refuse (introuvable) un enregistrement hors portée : on ne révèle pas son existence. */
export function assertInScope(s: Scope, employeeId: string, what: string) {
  if (!canSeeEmployee(s, employeeId)) throw notFound(what);
}

export function assertCan(ctx: Ctx, key: string, message?: string) {
  if (!ctx.can(key)) throw forbidden(message);
}

// Portées des registres
export const ACCIDENT_SCOPE: ScopeKeys = { all: ["hr.accident.read", "hr.accident.manage"] };
export const TIMEOFF_SCOPE: ScopeKeys = { all: ["hr.timeoff.read", "hr.timeoff.manage"], team: "hr.timeoff.approve", own: "hr.timeoff.request" };
export const ABSENCE_SCOPE: ScopeKeys = { all: ["hr.absence.read", "hr.absence.manage"], team: "hr.absence.approve" };
export const LATENESS_SCOPE: ScopeKeys = { all: ["hr.lateness.read", "hr.lateness.manage"] };
export const OVERTIME_SCOPE: ScopeKeys = { all: ["hr.overtime.read", "hr.overtime.manage"], team: "hr.overtime.approve", own: "hr.overtime.request" };
export const ADVANCE_SCOPE: ScopeKeys = { all: ["hr.advance.read", "hr.advance.manage"], team: "hr.advance.approve", own: "hr.advance.request" };
