import Link from "next/link";
import { Plus } from "lucide-react";
import { Status } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { num } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { customerBalance, invoiceBalance, isOverdue } from "../invoices";
import { effectiveQuoteStatus } from "../quotes";

/** Bandeau « solde client » de la fiche 360° : encours, échu, trop-perçu, plafond de crédit. */
export async function CustomerSalesSummary({ ctx, customerId, creditLimit }: { ctx: TenantContext; customerId: string; creditLimit: number | null }) {
  const b = await customerBalance(ctx, customerId);
  const cur = ctx.company.currency;
  const out = b.outstanding.toNumber();
  const items = [
    { label: "Solde client (encours)", value: formatMoney(out, cur), tone: out > 0 ? "text-foreground" : "text-success" },
    { label: "Dont échu", value: formatMoney(b.overdue.toNumber(), cur), tone: b.overdue.gt(0) ? "text-destructive" : "" },
    ...(b.credit.gt(0) ? [{ label: "Trop-perçu (crédit client)", value: formatMoney(b.credit.toNumber(), cur), tone: "text-success" }] : []),
    ...(creditLimit ? [{ label: "Plafond disponible", value: formatMoney(Math.max(0, creditLimit - out), cur), tone: creditLimit - out < 0 ? "text-destructive" : "" }] : []),
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((i) => <Card key={i.label}><CardContent className="space-y-1 p-5"><p className="text-sm text-muted-foreground">{i.label}</p><p className={`truncate text-xl font-semibold tabular ${i.tone}`}>{i.value}</p></CardContent></Card>)}
    </div>
  );
}

/** Onglet « Devis, commandes, factures, paiements » de la fiche client. */
export async function CustomerSalesPanel({ ctx, customerId }: { ctx: TenantContext; customerId: string }) {
  const cur = ctx.company.currency;
  const [quotes, orders, invoices, payments] = await Promise.all([
    ctx.can("sales.quote.read") ? ctx.db.quote.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 10 }) : Promise.resolve([]),
    ctx.can("sales.order.read") ? ctx.db.salesOrder.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 10 }) : Promise.resolve([]),
    ctx.db.invoice.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 15 }),
    ctx.can("finance.payment.read") ? ctx.db.payment.findMany({ where: { customerId, direction: "IN", status: { not: "CANCELLED" } }, orderBy: { date: "desc" }, take: 10, include: { invoice: { select: { number: true } } } }) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {ctx.can("sales.quote.create") && <Button asChild size="sm"><Link href={`/app/sales/devis/nouveau?client=${customerId}`}><Plus className="size-4" /> Devis</Link></Button>}
        {ctx.can("sales.order.create") && <Button asChild size="sm" variant="outline"><Link href={`/app/sales/commandes/nouveau?client=${customerId}`}><Plus className="size-4" /> Commande</Link></Button>}
        {ctx.can("finance.invoice.create") && <Button asChild size="sm" variant="outline"><Link href={`/app/sales/factures/nouveau?client=${customerId}`}><Plus className="size-4" /> Facture</Link></Button>}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Factures" empty="Aucune facture.">
          {invoices.map((i) => (
            <Link key={i.id} href={`/app/sales/factures/${i.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50">
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{i.number ?? "Brouillon"}</p><p className="text-xs text-muted-foreground">{fmtDate(i.issueDate)}{i.status === "ISSUED" || i.status === "PARTIALLY_PAID" ? ` · reste ${formatMoney(invoiceBalance(i).toNumber(), cur)}` : ""}</p></div>
              <span className="tabular text-sm">{formatMoney(num(i.total), cur)}</span><Status value={isOverdue(i) ? "OVERDUE" : i.status} />
            </Link>
          ))}
        </Section>
        <Section title="Paiements" empty="Aucun paiement.">
          {payments.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-6 py-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{p.number}</p><p className="text-xs text-muted-foreground">{fmtDate(p.date)} · {p.invoice?.number ?? ""}</p></div><span className="tabular text-sm">{formatMoney(num(p.amount), cur)}</span><Status value={p.status === "VALIDATED" ? "PAID" : "PENDING_APPROVAL"} /></div>
          ))}
        </Section>
        {ctx.can("sales.quote.read") && (
          <Section title="Devis" empty="Aucun devis.">
            {quotes.map((q) => <Link key={q.id} href={`/app/sales/devis/${q.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{q.number}</p><p className="text-xs text-muted-foreground">{fmtDate(q.issueDate)}</p></div><span className="tabular text-sm">{formatMoney(num(q.total), cur)}</span><Status value={effectiveQuoteStatus(q)} /></Link>)}
          </Section>
        )}
        {ctx.can("sales.order.read") && (
          <Section title="Commandes" empty="Aucune commande.">
            {orders.map((o) => <Link key={o.id} href={`/app/sales/commandes/${o.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{o.number}</p><p className="text-xs text-muted-foreground">{fmtDate(o.orderDate)}</p></div><span className="tabular text-sm">{formatMoney(num(o.total), cur)}</span><Status value={o.status} /></Link>)}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] | React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="divide-y p-0">{items.length === 0 ? <p className="px-6 pb-6 text-sm text-muted-foreground">{empty}</p> : children}</CardContent>
    </Card>
  );
}
