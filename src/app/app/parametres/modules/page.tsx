import type { Metadata } from "next";
import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { ModuleIcon } from "@/components/app/icons";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MODULES } from "@/core/modules/registry";
import { requireTenantContext } from "@/core/tenant/guards";

export const metadata: Metadata = { title: "Paramètres — Modules" };

export default async function ModulesSettingsPage() {
  const ctx = await requireTenantContext();
  const modules = MODULES.filter((m) => m.kind !== "CORE");

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Les modules actifs dépendent de l'offre de l'entreprise. Pour en activer d'autres, {ctx.can("settings.billing.read") ? <>consultez l'<Link href="/app/parametres/abonnement" className="text-brand hover:underline">abonnement</Link> ou </> : null}contactez votre gestionnaire de compte AfriGest 360.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {modules.map((m) => {
          const on = ctx.hasModule(m.key);
          return (
            <Card key={m.key} className={`flex-row items-start gap-3 p-4 ${on ? "" : "opacity-70"}`}>
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${on ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}><ModuleIcon name={m.icon} className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{m.name}</p>
                  {m.kind === "EXTENSION" && <Badge variant="outline">Extension</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{m.description}</p>
                <p className={`mt-2 flex items-center gap-1 text-xs font-medium ${on ? "text-success" : "text-muted-foreground"}`}>
                  {on ? <><Check className="size-3.5" /> Activé</> : <><Lock className="size-3.5" /> Non inclus dans votre offre</>}
                  {on && m.status === "planned" && <span className="font-normal text-muted-foreground"> · écrans à venir</span>}
                </p>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
