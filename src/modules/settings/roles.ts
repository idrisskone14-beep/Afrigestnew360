import "server-only";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { businessRule, forbidden, notFound } from "@/core/errors";
import { PERMISSION_BY_KEY } from "@/core/rbac/catalog";
import type { TenantContext } from "@/core/tenant/context";

type Ctx = Pick<TenantContext, "db" | "tx" | "company" | "user" | "access" | "can">;

export async function listRoles(ctx: Pick<TenantContext, "db">) {
  const roles = await ctx.db.role.findMany({
    orderBy: [{ isAdmin: "desc" }, { name: "asc" }],
    include: { _count: { select: { permissions: true, memberships: true } } },
  });
  return roles;
}

export async function getRolePermissionKeys(ctx: Pick<TenantContext, "db">, roleId: string): Promise<string[]> {
  const role = await ctx.db.role.findFirst({ where: { id: roleId } });
  if (!role) throw notFound("Rôle");
  const rows = await ctx.db.rolePermission.findMany({ where: { roleId }, select: { permission: { select: { key: true } } } });
  return rows.map((r) => r.permission.key);
}

export async function createRole(ctx: Ctx, input: { name: string; description?: string; copyFromRoleId?: string }) {
  const name = input.name.trim();
  const role = await ctx.tx(async (tx) => {
    const created = await tx.role.create({
      data: { companyId: ctx.company.id, name, description: input.description?.trim() || null },
    });
    if (input.copyFromRoleId) {
      const source = await tx.role.findFirst({ where: { id: input.copyFromRoleId } });
      if (!source) throw notFound("Rôle source");
      if (source.isAdmin && !ctx.access.isAdmin) throw forbidden();
      const keys = source.isAdmin ? [...PERMISSION_BY_KEY.keys()] : await getRolePermissionKeys({ db: tx }, source.id);
      // anti-escalade : on ne copie que ce que l'on détient soi-même
      const allowed = ctx.access.isAdmin ? keys : keys.filter((k) => ctx.can(k));
      await setPermissions(tx, ctx.company.id, created.id, allowed);
    }
    return created;
  });
  await audit(ctx, { action: "role.create", resource: "Role", resourceId: role.id, summary: `${ctx.user.name} a créé le rôle « ${role.name} ».`, after: { name: role.name } });
  return role;
}

async function setPermissions(db: Db, companyId: string, roleId: string, keys: string[]) {
  const perms = await db.permission.findMany({ where: { key: { in: [...new Set(keys)] } }, select: { id: true } });
  await db.rolePermission.deleteMany({ where: { roleId } });
  if (perms.length) await db.rolePermission.createMany({ data: perms.map((p) => ({ roleId, companyId, permissionId: p.id })) });
}

export async function updateRole(
  ctx: Ctx,
  input: { roleId: string; name: string; description?: string; permissionKeys: string[] },
) {
  const role = await ctx.db.role.findFirst({ where: { id: input.roleId } });
  if (!role) throw notFound("Rôle");

  const unknown = input.permissionKeys.filter((k) => !PERMISSION_BY_KEY.has(k));
  if (unknown.length) throw businessRule(`Permissions inconnues : ${unknown.join(", ")}`);

  if (role.isAdmin) {
    if (!ctx.access.isAdmin) throw forbidden("Seul un administrateur peut modifier ce rôle.");
    if (input.permissionKeys.length) throw businessRule("Le rôle Administrateur dispose automatiquement de toutes les permissions.");
  }

  const before = role.isAdmin ? [] : await getRolePermissionKeys(ctx, role.id);

  if (!role.isAdmin && !ctx.access.isAdmin) {
    // anti-escalade : seules les permissions déjà détenues peuvent être ajoutées
    const added = input.permissionKeys.filter((k) => !before.includes(k));
    const notHeld = added.filter((k) => !ctx.can(k));
    if (notHeld.length) throw forbidden("Vous ne pouvez pas accorder des permissions que vous ne détenez pas.");
  }

  const updated = await ctx.db.role.update({
    where: { id: role.id },
    data: { name: role.isSystem ? role.name : input.name.trim(), description: input.description?.trim() || null },
  });
  if (!role.isAdmin) await ctx.tx((tx) => setPermissions(tx, ctx.company.id, role.id, input.permissionKeys));

  await audit(ctx, {
    action: "role.update", resource: "Role", resourceId: role.id,
    summary: `${ctx.user.name} a modifié le rôle « ${updated.name} ».`,
    before: { name: role.name, permissions: before },
    after: { name: updated.name, permissions: role.isAdmin ? "toutes" : input.permissionKeys },
  });
  return updated;
}

export async function deleteRole(ctx: Ctx, roleId: string) {
  const role = await ctx.db.role.findFirst({ where: { id: roleId }, include: { _count: { select: { memberships: true, invitations: true } } } });
  if (!role) throw notFound("Rôle");
  if (role.isSystem) throw businessRule("Ce rôle système ne peut pas être supprimé.");
  if (role._count.memberships > 0) throw businessRule(`${role._count.memberships} membre(s) ont ce rôle : réaffectez-les d'abord.`);
  const rules = await ctx.db.approvalRuleStep.count({ where: { roleId } }) + (await ctx.db.approvalRule.count({ where: { requesterRoleId: roleId } }));
  if (rules > 0) throw businessRule("Ce rôle est utilisé par une règle de validation (Paramètres → Validations) : modifiez ou supprimez la règle d'abord.");
  await ctx.db.invitation.deleteMany({ where: { roleId } });
  await ctx.db.role.delete({ where: { id: roleId } });
  await audit(ctx, { action: "role.delete", resource: "Role", resourceId: roleId, summary: `${ctx.user.name} a supprimé le rôle « ${role.name} ».`, before: { name: role.name } });
}
