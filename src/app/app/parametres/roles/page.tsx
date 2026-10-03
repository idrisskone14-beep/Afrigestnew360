import type { Metadata } from "next";
import { requirePagePermission } from "@/core/tenant/guards";
import { getRolePermissionKeys, listRoles } from "@/modules/settings/roles";
import { RolesWorkspace } from "./roles-workspace";

export const metadata: Metadata = { title: "Paramètres — Rôles et permissions" };

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const ctx = await requirePagePermission("roles.role.read");
  const { role: selectedParam } = await searchParams;
  const roles = await listRoles(ctx);
  const selected = roles.find((r) => r.id === selectedParam) ?? roles[0];
  const keys = selected && !selected.isAdmin ? await getRolePermissionKeys(ctx, selected.id) : [];

  return (
    <RolesWorkspace
      canManage={ctx.can("roles.role.manage")}
      actorIsAdmin={ctx.access.isAdmin}
      actorPermissions={ctx.access.isAdmin ? null : [...ctx.access.granted]}
      enabledModules={[...ctx.access.modules]}
      roles={roles.map((r) => ({ id: r.id, name: r.name, description: r.description, isAdmin: r.isAdmin, isSystem: r.isSystem, members: r._count.memberships, permissions: r._count.permissions }))}
      selectedId={selected?.id ?? null}
      selectedKeys={keys}
    />
  );
}
