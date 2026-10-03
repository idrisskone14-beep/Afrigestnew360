import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";
import { Hammer } from "lucide-react";
import { ModuleIcon } from "@/components/app/icons";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MODULE_BY_KEY } from "@/core/modules/registry";
import { MODULE_ROADMAP } from "@/core/modules/roadmap";
import { PERMISSIONS } from "@/core/rbac/catalog";
import { requireTenantContext } from "@/core/tenant/guards";

type Props = { params: Promise<{ module: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { module } = await params;
  return { title: MODULE_BY_KEY.get(module)?.name ?? "Module" };
}

/**
 * Point d'entrée de chaque module. La garde est SERVEUR : module désactivé ou aucune permission du
 * module → 403, même si l'URL est saisie à la main. Les écrans métier sont livrés par phase ;
 * d'ici là cette page l'indique clairement au lieu de simuler des fonctionnalités.
 */
export default async function ModuleLandingPage({ params }: Props) {
  const { module: key } = await params;
  const def = MODULE_BY_KEY.get(key);
  if (!def || def.kind === "CORE") notFound();

  const ctx = await requireTenantContext();
  if (!ctx.hasModule(key)) forbidden();
  const permitted = ctx.access.isAdmin || PERMISSIONS.some((p) => p.module === key && ctx.can(p.key));
  if (!permitted) forbidden();

  const roadmap = MODULE_ROADMAP[key];

  return (
    <>
      <PageHeader
        title={def.name}
        description={def.description}
        breadcrumbs={[{ label: "Tableau de bord", href: "/app/dashboard" }, { label: def.name }]}
        actions={def.kind === "EXTENSION" ? <Badge variant="secondary">Extension</Badge> : undefined}
      />
      <Card>
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground"><ModuleIcon name={def.icon} className="size-5" /></span>
          <div>
            <CardTitle className="text-base">Module activé pour {ctx.company.tradeName ?? ctx.company.legalName}</CardTitle>
            <p className="text-sm text-muted-foreground">Votre rôle « {ctx.membership.roleName} » y a accès.</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {def.status === "planned" && roadmap && (
            <div className="rounded-lg border border-dashed p-4">
              <p className="flex items-center gap-2 text-sm font-medium"><Hammer className="size-4 text-warning" /> Écrans en cours de livraison (phase {roadmap.phase} du plan)</p>
              <p className="mt-1 text-sm text-muted-foreground">
                L'architecture (permissions, activation par offre, isolation des données) est déjà en place et testée. Ce module comprendra :
              </p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {roadmap.highlights.map((h) => <li key={h}>{h}</li>)}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
