import type { Metadata } from "next";
import { ModuleIcon } from "@/components/app/icons";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { platformDb } from "@/core/db/client";
import { MODULE_BY_KEY } from "@/core/modules/registry";
import { ModuleToggle } from "./module-toggle";

export const metadata: Metadata = { title: "Modules" };

export default async function ModulesCatalogPage() {
  const [modules, usage, plans] = await Promise.all([
    platformDb.module.findMany({ orderBy: { sortOrder: "asc" } }),
    platformDb.companyModule.groupBy({ by: ["moduleId"], where: { enabled: true }, _count: { _all: true } }),
    platformDb.planModule.findMany({ select: { moduleId: true, plan: { select: { name: true } } } }),
  ]);
  const used = new Map(usage.map((u) => [u.moduleId, u._count._all]));

  return (
    <>
      <PageHeader title="Catalogue des modules" description="Interrupteur global : un module désactivé ici disparaît pour toutes les entreprises, quelle que soit leur offre." />
      <Card className="divide-y p-0">
        {modules.map((m) => {
          const def = MODULE_BY_KEY.get(m.key);
          const inPlans = plans.filter((p) => p.moduleId === m.id).map((p) => p.plan.name);
          return (
            <div key={m.id} className="flex items-center gap-4 px-5 py-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><ModuleIcon name={m.icon} className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {m.name}
                  <Badge variant="outline" className="font-mono text-[10px]">{m.key}</Badge>
                  {m.kind === "EXTENSION" && <Badge variant="secondary">Extension</Badge>}
                  {def?.status === "planned" && <Badge variant="outline">Écrans à venir</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">{m.description}</p>
                <p className="mt-1 text-xs text-muted-foreground">{used.get(m.id) ?? 0} entreprise(s) · offres : {inPlans.length ? inPlans.join(", ") : "aucune"}</p>
              </div>
              <ModuleToggle moduleKey={m.key} isActive={m.isActive} locked={m.kind === "CORE"} />
            </div>
          );
        })}
      </Card>
    </>
  );
}
