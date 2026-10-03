import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { requireModulePage } from "@/core/tenant/guards";
import { forbidden } from "next/navigation";
import { REPORTS } from "@/modules/reports/catalog";
import { availableReports } from "@/modules/reports/service";

export const metadata: Metadata = { title: "Rapports" };

export default async function ReportsPage() {
  const ctx = await requireModulePage("reports");
  if (!ctx.can("reports.report.read")) forbidden();
  const mine = availableReports(ctx);
  const groups = [...new Set(REPORTS.map((r) => r.group))].map((g) => ({ group: g, items: mine.filter((r) => r.group === g) })).filter((g) => g.items.length > 0);
  const hidden = REPORTS.length - mine.length;

  return (
    <>
      <PageHeader title="Rapports et analyses" description="Centre de reporting transversal : filtrez par période, agence, département, client, fournisseur, projet ou centre de coûts, puis exportez en Excel, CSV ou PDF, ou imprimez." />
      {mine.length === 0 ? <EmptyState icon={<BarChart3 className="size-8" />} title="Aucun rapport disponible" description="Les rapports dépendent des modules activés pour votre entreprise et de vos droits de lecture." /> : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.group} aria-labelledby={`g-${g.group}`}>
              <h2 id={`g-${g.group}`} className="mb-3 text-sm font-semibold text-muted-foreground">{g.group}</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((r) => (
                  <Link key={r.key} href={`/app/reports/${r.key}`} className="group">
                    <Card className="h-full p-4 transition-colors group-hover:border-brand">
                      <h3 className="font-medium group-hover:text-brand">{r.title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ))}
          {hidden > 0 && <p className="text-xs text-muted-foreground">{hidden} autre{hidden > 1 ? "s" : ""} rapport{hidden > 1 ? "s" : ""} non affiché{hidden > 1 ? "s" : ""} : module inactif ou droit de lecture manquant.</p>}
        </div>
      )}
    </>
  );
}
