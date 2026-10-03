"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { runAction } from "@/components/app/form-kit";
import { toggleModuleAction } from "@/modules/platform/actions";

export function ModuleToggle({ moduleKey, isActive, locked }: { moduleKey: string; isActive: boolean; locked: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Switch
      checked={isActive}
      disabled={pending || locked}
      aria-label={`Module ${moduleKey} actif globalement`}
      onCheckedChange={(v) => start(async () => { const r = await runAction(toggleModuleAction({ moduleKey, isActive: v }), { success: v ? "Module réactivé" : "Module désactivé globalement" }); if (r.ok) router.refresh(); })}
    />
  );
}
