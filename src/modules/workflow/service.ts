import "server-only";
import { APPROVAL_TYPES, isApprovalType } from "@/core/approvals";
import { audit } from "@/core/audit";
import { businessRule, notFound } from "@/core/errors";
import { d } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import type { z } from "zod";
import type { ruleSchema, updateRuleSchema } from "./schemas";

type Ctx = TenantContext;

export const listRules = (ctx: Ctx) => ctx.db.approvalRule.findMany({
  orderBy: [{ resourceType: "asc" }, { priority: "desc" }, { createdAt: "asc" }],
  include: { steps: { orderBy: { stepOrder: "asc" }, include: { role: { select: { id: true, name: true } } } }, department: { select: { id: true, name: true } }, requesterRole: { select: { id: true, name: true } }, _count: { select: { requests: { where: { status: "PENDING" } } } } },
});

/** Un rôle ne peut valider que s'il détient « valider les demandes » (ou est administrateur) : sinon l'étape serait bloquée. */
async function assertStepRoles(ctx: Ctx, roleIds: string[]) {
  for (const id of new Set(roleIds)) {
    const role = await ctx.db.role.findFirst({ where: { id }, select: { name: true, isAdmin: true, permissions: { where: { permission: { key: "workflow.request.approve" } }, select: { permissionId: true } } } });
    if (!role) throw notFound("Rôle");
    if (!role.isAdmin && role.permissions.length === 0) throw businessRule(`Le rôle « ${role.name} » ne peut pas valider : il n'a pas la permission « Demandes d'approbation — valider ». Ajoutez-la dans Rôles et permissions.`);
  }
}

async function check(ctx: Ctx, input: z.output<typeof ruleSchema>) {
  if (!isApprovalType(input.resourceType)) throw notFound("Type d'opération");
  if (input.departmentId && !(await ctx.db.department.findFirst({ where: { id: input.departmentId, deletedAt: null }, select: { id: true } }))) throw notFound("Département");
  if (input.requesterRoleId && !(await ctx.db.role.findFirst({ where: { id: input.requesterRoleId }, select: { id: true } }))) throw notFound("Rôle du demandeur");
  const max = input.maxAmount === "" || input.maxAmount === undefined ? null : input.maxAmount;
  if (max !== null && max <= input.minAmount) throw businessRule("La limite haute doit dépasser le minimum.");
  await assertStepRoles(ctx, input.steps.map((s) => s.roleId));
  return max;
}

const describe = (ctx: Ctx, i: z.output<typeof ruleSchema>) => `« ${i.name} » (${APPROVAL_TYPES[i.resourceType as keyof typeof APPROVAL_TYPES].label}, ${i.steps.length} étape${i.steps.length > 1 ? "s" : ""})`;

export async function createRule(ctx: Ctx, input: z.output<typeof ruleSchema>) {
  const max = await check(ctx, input);
  const rule = await ctx.db.approvalRule.create({
    data: {
      companyId: ctx.company.id, resourceType: input.resourceType, name: input.name, minAmount: input.minAmount, maxAmount: max, departmentId: input.departmentId || null, requesterRoleId: input.requesterRoleId || null,
      priority: input.priority, isActive: input.isActive, createdById: ctx.user.id,
      steps: { create: input.steps.map((s, i) => ({ companyId: ctx.company.id, stepOrder: i + 1, label: s.label, roleId: s.roleId })) },
    },
  });
  await audit(ctx, { action: "approval.rule_create", resource: "ApprovalRule", resourceId: rule.id, summary: `${ctx.user.name} a créé la règle de validation ${describe(ctx, input)}.`, after: input });
  return rule;
}

/** Les étapes d'une règle ne se modifient pas tant que des demandes en cours la suivent (désactivez-la et créez-en une nouvelle). */
async function pendingCount(ctx: Ctx, id: string) {
  return ctx.db.approvalRequest.count({ where: { ruleId: id, status: "PENDING" } });
}

export async function updateRule(ctx: Ctx, input: z.output<typeof updateRuleSchema>) {
  const before = await ctx.db.approvalRule.findFirst({ where: { id: input.id }, include: { steps: { orderBy: { stepOrder: "asc" } } } });
  if (!before) throw notFound("Règle");
  const max = await check(ctx, input);
  const sameSteps = before.steps.length === input.steps.length && before.steps.every((s, i) => s.roleId === input.steps[i]!.roleId && s.label === input.steps[i]!.label);
  if (!sameSteps && (await pendingCount(ctx, input.id)) > 0) throw businessRule("Des demandes suivent actuellement cette règle : on ne peut pas en modifier les étapes. Désactivez-la et créez-en une nouvelle.");
  await ctx.tx(async (tx) => {
    await tx.approvalRule.update({ where: { id: input.id }, data: { resourceType: input.resourceType, name: input.name, minAmount: input.minAmount, maxAmount: max, departmentId: input.departmentId || null, requesterRoleId: input.requesterRoleId || null, priority: input.priority, isActive: input.isActive } });
    if (!sameSteps) {
      await tx.approvalRuleStep.deleteMany({ where: { ruleId: input.id } });
      await tx.approvalRuleStep.createMany({ data: input.steps.map((s, i) => ({ companyId: ctx.company.id, ruleId: input.id, stepOrder: i + 1, label: s.label, roleId: s.roleId })) });
    }
  });
  await audit(ctx, { action: "approval.rule_update", resource: "ApprovalRule", resourceId: input.id, summary: `${ctx.user.name} a modifié la règle de validation ${describe(ctx, input)}.`, before: { name: before.name, min: d(before.minAmount).toNumber(), steps: before.steps.length }, after: input });
}

export async function toggleRule(ctx: Ctx, id: string, isActive: boolean) {
  const rule = await ctx.db.approvalRule.findFirst({ where: { id } });
  if (!rule) throw notFound("Règle");
  await ctx.db.approvalRule.update({ where: { id }, data: { isActive } });
  await audit(ctx, { action: isActive ? "approval.rule_enable" : "approval.rule_disable", resource: "ApprovalRule", resourceId: id, summary: `${ctx.user.name} a ${isActive ? "activé" : "désactivé"} la règle de validation « ${rule.name} ».` });
}

export async function deleteRule(ctx: Ctx, id: string) {
  const rule = await ctx.db.approvalRule.findFirst({ where: { id } });
  if (!rule) throw notFound("Règle");
  if ((await pendingCount(ctx, id)) > 0) throw businessRule("Des demandes suivent actuellement cette règle : désactivez-la plutôt que de la supprimer.");
  await ctx.db.approvalRule.delete({ where: { id } });
  await audit(ctx, { action: "approval.rule_delete", resource: "ApprovalRule", resourceId: id, summary: `${ctx.user.name} a supprimé la règle de validation « ${rule.name} ».` });
}
