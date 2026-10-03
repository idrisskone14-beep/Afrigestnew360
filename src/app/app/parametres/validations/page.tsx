import type { Metadata } from "next";
import { APPROVAL_TYPES, APPROVAL_TYPE_KEYS, listPolicies } from "@/core/approvals";
import { requirePagePermission } from "@/core/tenant/guards";
import { d } from "@/core/money";
import { listRules } from "@/modules/workflow/service";
import { RulesPanel } from "@/modules/workflow/ui/rules-panel";
import { PoliciesPanel } from "./policies-panel";

export const metadata: Metadata = { title: "Paramètres — Validations" };

export default async function ValidationSettingsPage() {
  const ctx = await requirePagePermission("settings.company.read");
  const [policies, rules, roles, departments] = await Promise.all([
    listPolicies(ctx),
    listRules(ctx),
    ctx.db.role.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, isAdmin: true, permissions: { where: { permission: { key: "workflow.request.approve" } }, select: { permissionId: true } } } }),
    ctx.db.department.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="space-y-10">
      <PoliciesPanel canManage={ctx.can("workflow.policy.manage")} currency={ctx.company.currency} policies={policies.map((p) => ({ type: p.type, label: p.label, isEnabled: p.isEnabled, threshold: p.threshold, available: ctx.hasModule(p.module) }))} />
      <RulesPanel
        canManage={ctx.can("workflow.policy.manage")}
        types={APPROVAL_TYPE_KEYS.map((t) => ({ type: t, label: APPROVAL_TYPES[t].label }))}
        roles={roles.map((r) => ({ id: r.id, name: r.name, canApprove: r.isAdmin || r.permissions.length > 0 }))}
        departments={departments}
        rules={rules.map((r) => ({
          id: r.id, resourceType: r.resourceType, name: r.name, minAmount: d(r.minAmount).toNumber(), maxAmount: r.maxAmount === null ? null : d(r.maxAmount).toNumber(), departmentId: r.departmentId ?? "", requesterRoleId: r.requesterRoleId ?? "",
          priority: r.priority, isActive: r.isActive, pending: r._count.requests, steps: r.steps.map((s) => ({ label: s.label, roleId: s.roleId })),
        }))}
      />
    </div>
  );
}
