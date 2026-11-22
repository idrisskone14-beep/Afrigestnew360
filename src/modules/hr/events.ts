import "server-only";
import { registerDecisionGuard } from "@/core/approval-guards";
import { forbidden } from "@/core/errors";
import { on } from "@/core/events";
import { ABSENCE_SCOPE, ADVANCE_SCOPE, OVERTIME_SCOPE, TIMEOFF_SCOPE, canSeeEmployee, scopeOf } from "./scope";

/** Le module RH applique la décision d'un approbateur aux demandes de congé, de permission et d'absence. */
on("approval.decided", async (tx, ctx, { requestId, resourceType, resourceId, decision }) => {
  if (resourceType === "leave") {
    const r = await tx.leaveRequest.findFirst({ where: { id: resourceId } });
    if (r?.status === "PENDING") await tx.leaveRequest.update({ where: { id: resourceId }, data: { status: decision === "APPROVED" ? "APPROVED" : "REJECTED" } });
    return;
  }
  if (resourceType !== "timeoff" && resourceType !== "absence" && resourceType !== "overtime" && resourceType !== "advance") return;
  const req = await tx.approvalRequest.findFirst({ where: { id: requestId }, select: { comment: true } });
  const data = { status: decision, decidedById: ctx.user.id, decidedAt: new Date(), decisionComment: req?.comment ?? null } as const;
  // seule une demande encore EN ATTENTE est décidée : une annulation intermédiaire n'est jamais « ressuscitée »
  if (resourceType === "timeoff") await tx.timeOffRequest.updateMany({ where: { id: resourceId, status: "PENDING" }, data });
  else if (resourceType === "absence") await tx.absenceRecord.updateMany({ where: { id: resourceId, status: "PENDING" }, data });
  else if (resourceType === "advance") await tx.salaryAdvance.updateMany({ where: { id: resourceId, status: "PENDING" }, data });
  else {
    // heures supplémentaires : à la validation, toutes les heures déclarées sont retenues (la RH peut ensuite en traiter le taux)
    const o = await tx.overtimeRecord.findFirst({ where: { id: resourceId, status: "PENDING" }, select: { hours: true } });
    if (o) await tx.overtimeRecord.updateMany({ where: { id: resourceId, status: "PENDING" }, data: { ...data, approvedHours: decision === "APPROVED" ? o.hours : null } });
  }
});

/**
 * Un responsable ne valide que les permissions et absences de son équipe (hiérarchie « Responsable ») ; la RH (droit de gestion) et les administrateurs valident toutes.
 * Une règle de validation à étapes configurée par l'entreprise garde la main : elle désigne elle-même les rôles décideurs.
 */
registerDecisionGuard("timeoff", async (tx, ctx, req) => {
  if (req.ruleId) return; // chaîne de validation configurée par l'entreprise : elle désigne elle-même les rôles décideurs
  const r = await tx.timeOffRequest.findFirst({ where: { id: req.resourceId }, select: { employeeId: true } });
  if (r && !canSeeEmployee(await scopeOf(ctx, TIMEOFF_SCOPE), r.employeeId)) throw forbidden("Cette permission concerne un salarié hors de votre équipe.");
});
registerDecisionGuard("absence", async (tx, ctx, req) => {
  if (req.ruleId) return;
  const r = await tx.absenceRecord.findFirst({ where: { id: req.resourceId }, select: { employeeId: true } });
  if (r && !canSeeEmployee(await scopeOf(ctx, ABSENCE_SCOPE), r.employeeId)) throw forbidden("Cette absence concerne un salarié hors de votre équipe.");
});

registerDecisionGuard("overtime", async (tx, ctx, req) => {
  if (req.ruleId) return;
  const r = await tx.overtimeRecord.findFirst({ where: { id: req.resourceId }, select: { employeeId: true } });
  if (r && !canSeeEmployee(await scopeOf(ctx, OVERTIME_SCOPE), r.employeeId)) throw forbidden("Ces heures concernent un salarié hors de votre équipe.");
});
registerDecisionGuard("advance", async (tx, ctx, req) => {
  if (req.ruleId) return;
  const r = await tx.salaryAdvance.findFirst({ where: { id: req.resourceId }, select: { employeeId: true } });
  if (r && !canSeeEmployee(await scopeOf(ctx, ADVANCE_SCOPE), r.employeeId)) throw forbidden("Cette avance concerne un salarié hors de votre équipe.");
});
