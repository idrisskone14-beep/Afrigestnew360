import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { num } from "@/core/money";
import { formatMoney } from "@/lib/reference-data";
import { cn } from "@/lib/utils";

type N = { toString(): string } | number;
export interface DocLine {
  id: string; description: string; unit: string; quantity: N; unitPrice: N; discountPct: N; taxRate: N; total: N;
  deliveredQty?: N; invoicedQty?: N;
}

export function LinesView({ lines, currency, showProgress, progressLabels = ["Livré", "Facturé"] }: { lines: DocLine[]; currency: string; showProgress?: boolean; progressLabels?: [string, string] }) {
  return (
    <Card className="overflow-hidden p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Désignation</TableHead>
            <TableHead className="text-right">Qté</TableHead>
            {showProgress && <TableHead className="hidden text-right md:table-cell">{progressLabels[0]}</TableHead>}
            {showProgress && <TableHead className="hidden text-right md:table-cell">{progressLabels[1]}</TableHead>}
            <TableHead className="hidden text-right sm:table-cell">P.U. HT</TableHead>
            <TableHead className="hidden text-right lg:table-cell">Rem.</TableHead>
            <TableHead className="hidden text-right lg:table-cell">TVA</TableHead>
            <TableHead className="text-right">Total TTC</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="max-w-xs whitespace-normal text-sm">{l.description}</TableCell>
              <TableCell className="text-right text-sm tabular">{num(l.quantity)} {l.unit}</TableCell>
              {showProgress && <TableCell className="hidden text-right text-sm tabular md:table-cell">{num(l.deliveredQty ?? 0)}</TableCell>}
              {showProgress && <TableCell className="hidden text-right text-sm tabular md:table-cell">{num(l.invoicedQty ?? 0)}</TableCell>}
              <TableCell className="hidden text-right text-sm tabular sm:table-cell">{formatMoney(num(l.unitPrice), currency)}</TableCell>
              <TableCell className="hidden text-right text-sm tabular lg:table-cell">{num(l.discountPct) ? `${num(l.discountPct)} %` : "—"}</TableCell>
              <TableCell className="hidden text-right text-sm tabular lg:table-cell">{num(l.taxRate) ? `${num(l.taxRate)} %` : "—"}</TableCell>
              <TableCell className="text-right text-sm font-medium tabular">{formatMoney(num(l.total), currency)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export function TotalsView({ rows, currency }: { rows: { label: string; value: N; bold?: boolean; tone?: "danger" | "success" }[]; currency: string }) {
  return (
    <Card className="ml-auto w-full max-w-sm">
      <CardContent className="space-y-1.5 p-5">
        {rows.map((r) => (
          <div key={r.label} className={cn("flex justify-between gap-4 text-sm", r.bold && "border-t pt-2 text-base font-semibold", r.tone === "danger" && "text-destructive", r.tone === "success" && "text-success")}>
            <span className={r.bold ? "" : "text-muted-foreground"}>{r.label}</span>
            <span className="tabular">{formatMoney(num(r.value), currency)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function PdfLinks({ kind, id }: { kind: string; id: string }) {
  return (
    <>
      <Button variant="outline" asChild><a href={`/api/pdf/${kind}/${id}`} target="_blank" rel="noopener noreferrer"><FileText className="size-4" /> Voir le PDF</a></Button>
      <Button variant="outline" size="icon" asChild aria-label="Télécharger le PDF"><a href={`/api/pdf/${kind}/${id}?download=1`}><Download className="size-4" /></a></Button>
    </>
  );
}

export function DocHeader({ crumbs, title, badges, actions, subtitle }: { crumbs: { label: string; href?: string }[]; title: string; badges?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{crumbs.map((c, i) => <span key={c.label}>{c.href ? <Link href={c.href} className="hover:text-foreground">{c.label}</Link> : c.label}{i < crumbs.length - 1 ? " / " : ""}</span>)}</p>
        <h2 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">{title}{badges}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
