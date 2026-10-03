import type { Metadata } from "next";
import { requireTenantContext } from "@/core/tenant/guards";
import { NOTIFICATION_TYPES } from "@/modules/settings/schemas";
import { NotificationPrefsForm } from "./prefs-form";

export const metadata: Metadata = { title: "Paramètres — Notifications" };

export default async function NotificationPrefsPage() {
  const ctx = await requireTenantContext();
  const saved = await ctx.db.notificationPreference.findMany({ where: { userId: ctx.user.id } });
  const byType = new Map(saved.map((p) => [p.type, p]));
  return (
    <NotificationPrefsForm
      // seuls les types des modules actifs sont proposés ; un type dont l'émetteur n'est pas encore livré est signalé
      initial={NOTIFICATION_TYPES.filter((t) => !("module" in t) || ctx.hasModule(t.module) || ("comingSoon" in t && t.comingSoon)).map((t) => ({
        type: t.type, label: t.label, note: "comingSoon" in t && t.comingSoon ? "Bientôt disponible" : undefined, inApp: byType.get(t.type)?.inApp ?? true, email: byType.get(t.type)?.email ?? false,
      }))}
    />
  );
}
