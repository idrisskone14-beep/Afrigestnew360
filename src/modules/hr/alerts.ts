import "server-only";
import { pendingDecisionCount } from "@/core/approvals";
import type { TenantContext } from "@/core/tenant/context";
import { repeatedAbsences } from "./absences";
import { listAccidents } from "./accidents";
import { endingContracts, canSeePay } from "./employees";
import { equipmentAlerts } from "./equipment";
import { recurringLateness } from "./lateness";
import { visitAlerts } from "./medvisits";
import { sickLeaveAlerts } from "./sickleave";

type Ctx = TenantContext;

/**
 * « Alertes et échéances » : tout ce qui demande l'attention de la RH, rassemblé. Chaque section n'est calculée que pour l'utilisateur qui a le droit
 * du registre concerné (sinon elle est absente, pas vide). Aucune alerte ne déclenche d'action : ce sont des signaux, jamais des sanctions ni des retenues.
 */
export async function hrAlerts(ctx: Ctx, today = new Date()) {
  const when = <T>(ok: boolean, f: () => Promise<T>) => (ok ? f() : Promise.resolve(null));
  const [contracts, sick, visits, equipment, accidents, repeated, lateness, pending] = await Promise.all([
    when(canSeePay(ctx), () => endingContracts(ctx, 60)),
    when(ctx.can("hr.sickleave.read"), () => sickLeaveAlerts(ctx, today)),
    when(ctx.can("hr.medvisit.read"), () => visitAlerts(ctx, today)),
    when(ctx.can("hr.equipment.read"), () => equipmentAlerts(ctx, today)),
    when(ctx.can("hr.accident.read"), async () => (await listAccidents(ctx, { status: "OPEN", skip: 0, take: 200 })).rows.filter((r) => r.gaps.some((g) => g.blocking || g.code === "cnps_late"))),
    when(ctx.can("hr.absence.read") || ctx.can("hr.absence.manage"), () => repeatedAbsences(ctx, today)),
    when(ctx.can("hr.lateness.read") || ctx.can("hr.lateness.manage"), () => recurringLateness(ctx, today)),
    pendingDecisionCount(ctx),
  ]);
  const count = [contracts?.length, sick?.length, visits ? visits.overdue.length + visits.soon.length + visits.toSchedule.length : 0, equipment?.length, accidents?.length, repeated?.length, lateness?.length].reduce<number>((a, b) => a + (b ?? 0), 0);
  return { contracts, sick, visits, equipment, accidents, repeated, lateness, pending, count };
}
