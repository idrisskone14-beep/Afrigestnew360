import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { closeFiscalYearAction } from "@/modules/accounting/actions";
import { listFiscalYears } from "@/modules/accounting/service";
import { BackfillButton, NewYearDialog, PeriodToggles } from "@/modules/accounting/ui/year-panels";

export const metadata: Metadata = { title: "Exercices comptables" };

export default async function FiscalYearsPage() {
  const ctx = await requirePagePermission("accounting.ledger.read");
  const years = await listFiscalYears(ctx);
  const manage = ctx.can("accounting.period.manage");
  const last = years[0];
  const suggested = last ? new Date(last.endDate.getTime() + 86_400_000).toISOString().slice(0, 10) : `${new Date().getFullYear()}-01-01`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto max-w-2xl text-sm text-muted-foreground">Une période verrouillée refuse toute nouvelle écriture (ventes, paiements, dépenses… y compris). La clôture d'un exercice solde les comptes de gestion, reporte les soldes du bilan dans l'exercice suivant et verrouille l'exercice définitivement.</p>
        {ctx.can("accounting.entry.create") && ctx.can("accounting.entry.validate") && <BackfillButton />}
        {manage && <NewYearDialog suggestedStart={suggested} />}
      </div>
      {years.map((y) => (
        <Card key={y.id}>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-3 text-base">Exercice {y.name}<StatusBadge tone={y.status === "OPEN" ? "success" : "neutral"}>{y.status === "OPEN" ? "Ouvert" : "Clôturé"}</StatusBadge></CardTitle>
            <p className="text-xs text-muted-foreground">{fmtDate(y.startDate)} → {fmtDate(y.endDate)}{y.closedAt ? ` · clôturé le ${fmtDate(y.closedAt)}` : ""}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <PeriodToggles canManage={manage} closed={y.status === "CLOSED"} periods={y.periods.map((p) => ({ id: p.id, month: p.startDate.getUTCMonth(), status: p.status }))} />
            {y.status === "OPEN" && manage && (
              <ActionButton action={closeFiscalYearAction} input={{ id: y.id }} variant="outline" label="Clôturer l'exercice" icon={<Lock className="size-4" />} success="Exercice clôturé"
                confirm={{ title: `Clôturer l'exercice ${y.name} ?`, description: "Les comptes de charges et de produits sont soldés vers le résultat, les soldes de bilan sont reportés dans l'exercice suivant (créé si besoin), puis l'exercice est verrouillé. Cette opération est irréversible.", confirmLabel: "Clôturer définitivement" }} />
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
