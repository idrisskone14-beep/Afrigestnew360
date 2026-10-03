import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, BookOpenCheck, FilePen, TrendingUp, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Status } from "@/components/app/status-badge";
import { requireTenantContext } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { balanceSheet, defaultFiscalYear, incomeStatement, trialBalance } from "@/modules/accounting/reports";
import { ensureChart } from "@/modules/accounting/service";
import { num } from "@/core/money";

export const metadata: Metadata = { title: "Comptabilité" };

export default async function AccountingOverview() {
  const ctx = await requireTenantContext();
  await ensureChart(ctx);
  const fy = await defaultFiscalYear(ctx);
  const cur = ctx.company.currency;
  const canLedger = ctx.can("accounting.ledger.read");
  if (!fy) return <p className="text-sm text-muted-foreground">Aucun exercice comptable.</p>;

  const [is, tb, bs, drafts, recent] = await Promise.all([
    canLedger ? incomeStatement(ctx, { fiscalYearId: fy.id }) : Promise.resolve(null),
    canLedger ? trialBalance(ctx, { fiscalYearId: fy.id }) : Promise.resolve(null),
    canLedger ? balanceSheet(ctx, { fiscalYearId: fy.id }) : Promise.resolve(null),
    ctx.db.journalEntry.count({ where: { fiscalYearId: fy.id, status: "DRAFT" } }),
    ctx.can("accounting.entry.read") ? ctx.db.journalEntry.findMany({ where: { fiscalYearId: fy.id, status: "POSTED" }, orderBy: [{ date: "desc" }, { number: "desc" }], take: 8, include: { journal: { select: { code: true } }, lines: { select: { debit: true } } } }) : Promise.resolve([]),
  ]);
  const checks = [
    tb && { ok: tb.balanced, label: "Balance équilibrée (total débit = total crédit)" },
    bs && { ok: bs.totalAssets.eq(bs.totalLiabilities), label: "Bilan équilibré (actif = passif)" },
    { ok: drafts === 0, label: drafts === 0 ? "Aucune écriture en brouillon" : `${drafts} écriture${drafts > 1 ? "s" : ""} en brouillon` },
  ].filter((c): c is { ok: boolean; label: string } => Boolean(c));

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Exercice <span className="font-medium text-foreground">{fy.name}</span> ({fmtDate(fy.startDate)} → {fmtDate(fy.endDate)}) · {fy.status === "OPEN" ? "ouvert" : "clôturé"}</p>
      {is && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi icon={<TrendingUp className="size-4" />} label="Produits" value={formatMoney(is.totalProducts.toNumber(), cur)} href="/app/accounting/etats" />
          <Kpi icon={<Wallet className="size-4" />} label="Charges" value={formatMoney(is.totalCharges.toNumber(), cur)} href="/app/accounting/etats" />
          <Kpi icon={<BookOpenCheck className="size-4" />} label="Résultat" value={formatMoney(is.result.toNumber(), cur)} tone={is.result.lt(0) ? "danger" : undefined} href="/app/accounting/etats" />
          <Kpi icon={<FilePen className="size-4" />} label="Brouillons" value={String(drafts)} hint="Écritures à valider" href="/app/accounting/ecritures?statut=DRAFT" />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Contrôles de cohérence</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {checks.map((c) => (
              <p key={c.label} className="flex items-center gap-2 text-sm">{c.ok ? <span className="size-2 rounded-full bg-success" aria-hidden /> : <AlertTriangle className="size-4 text-warning" aria-hidden />}<span className={c.ok ? "" : "font-medium"}>{c.label}</span></p>
            ))}
            <p className="pt-2 text-xs text-muted-foreground">Les écritures de ventes, achats, paiements et dépenses sont générées automatiquement et ne sont plus modifiables : une erreur se corrige en annulant le document (contre-passation). La valeur du stock n'est pas comptabilisée au fil de l'eau (inventaire intermittent) : constatez-la en fin de période par une écriture de variation de stocks (311 / 6031).</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Dernières écritures</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {recent.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucune écriture validée.</p>}
            {recent.map((e) => (
              <Link key={e.id} href={`/app/accounting/ecritures/${e.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{e.number} · {e.description}</p><p className="text-xs text-muted-foreground">{fmtDate(e.date)} · {e.journal.code}</p></div>
                <span className="tabular text-sm">{formatMoney(e.lines.reduce((a, l) => a + num(l.debit), 0), cur)}</span>
                <Status value="POSTED" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, hint, href, tone }: { icon: React.ReactNode; label: string; value: string; hint?: string; href: string; tone?: "danger" }) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:border-brand/50">
        <CardContent className="space-y-1 p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">{icon}{label}</div>
          <div className={`truncate text-xl font-semibold tracking-tight tabular 2xl:text-2xl ${tone === "danger" ? "text-destructive" : ""}`}>{value}</div>
          {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        </CardContent>
      </Card>
    </Link>
  );
}
