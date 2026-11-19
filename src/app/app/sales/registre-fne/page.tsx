import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { BarsChart } from "@/components/app/lazy-charts";
import { ListScope } from "@/components/app/data-list";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { periodFor } from "@/core/tenant/period";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { fneFeatureEnabled } from "@/modules/sales/fne/feature";
import { loadFneRevenue } from "@/modules/sales/fne/registry";
import { FneRegistryImportCard } from "@/modules/sales/fne/registry-import-card";

export const metadata: Metadata = { title: "Registre FNE" };

const METHODS: Record<string, string> = { check: "Chèque", transfer: "Virement", cash: "Espèces", card: "Carte bancaire", "mobile-money": "Mobile Money", deferred: "À terme" };
const KIND = { INVOICE: { label: "Facture", variant: "outline" }, REFUND: { label: "Avoir", variant: "destructive" }, PROFORMA: { label: "Proforma", variant: "secondary" } } as const;
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export default async function FneRegistryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (!fneFeatureEnabled()) notFound();
  const ctx = await requirePagePermission("finance.invoice.read");
  if (!ctx.hasModule("sales")) notFound();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const period = await periodFor(sp, "date");
  const canImport = ctx.can("finance.invoice.create");
  const currency = ctx.company.currency;
  const where = { issuedAt: { ...(period.gte ? { gte: period.gte } : {}), ...(period.lt ? { lt: period.lt } : {}) } };

  const [totalEver, revenue, rows, total] = await Promise.all([
    ctx.db.fneRegistryEntry.count(),
    loadFneRevenue(ctx, period),
    ctx.db.fneRegistryEntry.findMany({ where, orderBy: [{ issuedAt: "desc" }, { reference: "desc" }], skip: lp.skip, take: lp.take }),
    ctx.db.fneRegistryEntry.count({ where }),
  ]);
  const money = (v: number) => formatMoney(v, currency);

  return (
    <ListScope filename="registre-fne">
      <p className="text-sm text-muted-foreground">
        Le chiffre d&apos;affaires de vos factures certifiées par la DGI, d&apos;après l&apos;export de votre espace FNE : les avoirs sont retranchés, les proformas ne sont pas comptées.
      </p>
      {canImport && <FneRegistryImportCard hasData={totalEver > 0} />}

      {totalEver === 0 ? (
        <EmptyState icon={<FileSpreadsheet className="size-8" />} title="Registre vide" description="Importez l'export de vos factures FNE pour suivre votre chiffre d'affaires par mois, par client et par mode de paiement." />
      ) : (
        <>
          <ListToolbar placeholder="" filters={[{ name: "date", label: "Date", kind: "date" }]} hideSearch />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Chiffre d'affaires HT" value={money(revenue.ht)} hint="factures − avoirs" />
            <Kpi label="TVA collectée" value={money(revenue.vat)} hint="sur la même période" />
            <Kpi label="Chiffre d'affaires TTC" value={money(revenue.ttc)} hint="net à encaisser" />
            <Kpi label="Documents" value={`${revenue.invoices.toLocaleString("fr-FR")} factures`} hint={`${revenue.refunds.toLocaleString("fr-FR")} avoirs (${money(revenue.refundsTtc)}) · ${revenue.proformas.toLocaleString("fr-FR")} proformas non comptées`} />
          </div>

          {revenue.months.length > 0 && (
            <Card className="p-4"><BarsChart data={revenue.months.map((m) => ({ month: m.month, value: m.ht }))} currency={currency} seriesLabel="Chiffre d'affaires HT par mois" /></Card>
          )}

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="overflow-hidden p-0 xl:col-span-2">
              <CardHeader><CardTitle className="text-base">Par mois</CardTitle></CardHeader>
              <Table>
                <TableHeader><TableRow><TableHead>Mois</TableHead><TableHead className="text-right">Factures</TableHead><TableHead className="hidden text-right sm:table-cell">Avoirs</TableHead><TableHead className="text-right">CA HT</TableHead><TableHead className="hidden text-right md:table-cell">TVA</TableHead><TableHead className="text-right">CA TTC</TableHead></TableRow></TableHeader>
                <TableBody>
                  {revenue.months.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell className="text-sm capitalize">{monthName(m.month)}</TableCell>
                      <TableCell className="text-right text-sm tabular">{m.invoices}</TableCell>
                      <TableCell className="hidden text-right text-sm tabular sm:table-cell">{m.refunds}</TableCell>
                      <TableCell className="text-right text-sm tabular">{money(m.ht)}</TableCell>
                      <TableCell className="hidden text-right text-sm tabular md:table-cell">{money(m.vat)}</TableCell>
                      <TableCell className="text-right text-sm tabular">{money(m.ttc)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>

            <div className="grid content-start gap-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Mode de paiement</CardTitle><CardDescription>Tel que déclaré à la FNE.</CardDescription></CardHeader>
                <CardContent className="grid gap-2">
                  {revenue.methods.map((m) => (
                    <div key={m.method} className="flex items-center justify-between gap-3 text-sm"><span>{METHODS[m.method] ?? m.method}</span><span className="tabular text-muted-foreground">{money(m.ttc)} · {m.documents}</span></div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>

          <Card className="overflow-hidden p-0">
            <CardHeader><CardTitle className="text-base">Principaux clients</CardTitle><CardDescription>{revenue.customers.length.toLocaleString("fr-FR")} client{revenue.customers.length > 1 ? "s" : ""} sur la période, classés par chiffre d&apos;affaires HT.</CardDescription></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="hidden sm:table-cell">NCC</TableHead><TableHead className="text-right">Documents</TableHead><TableHead className="text-right">CA HT</TableHead><TableHead className="hidden text-right md:table-cell">Part</TableHead></TableRow></TableHeader>
              <TableBody>
                {revenue.customers.slice(0, 10).map((c) => (
                  <TableRow key={c.key}>
                    <TableCell className="text-sm font-medium">{c.name}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{c.ncc ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm tabular">{c.documents}</TableCell>
                    <TableCell className="text-right text-sm tabular">{money(c.ht)}</TableCell>
                    <TableCell className="hidden text-right text-sm tabular text-muted-foreground md:table-cell">{revenue.ht > 0 ? `${((c.ht / revenue.ht) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Card className="overflow-hidden p-0">
            <CardHeader><CardTitle className="text-base">Documents</CardTitle><CardDescription>{total.toLocaleString("fr-FR")} document{total > 1 ? "s" : ""} sur la période, du plus récent au plus ancien.</CardDescription></CardHeader>
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>N° FNE</TableHead><TableHead>Type</TableHead><TableHead>Client</TableHead><TableHead className="text-right">HT</TableHead><TableHead className="text-right">TTC</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(r.issuedAt)}</TableCell>
                    <TableCell className="text-sm">
                      {r.reference.startsWith("SANS-NUMERO-") ? <span className="text-xs text-warning">sans numéro FNE</span> : <span className="font-mono text-xs">{r.reference}</span>}
                      {r.initialReference && <span className="block text-xs text-muted-foreground">sur {r.initialReference}</span>}
                    </TableCell>
                    <TableCell><Badge variant={KIND[r.kind].variant}>{KIND[r.kind].label}</Badge></TableCell>
                    <TableCell className="text-sm">{r.customerName}</TableCell>
                    <TableCell className="text-right text-sm tabular">{money(num(r.totalHt))}</TableCell>
                    <TableCell className="text-right text-sm tabular">{money(num(r.totalTtc))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/sales/registre-fne" searchParams={sp} />
        </>
      )}
    </ListScope>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold tabular">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}
