import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, FileText, HandCoins, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Status } from "@/components/app/status-badge";
import { num } from "@/core/money";
import { requireTenantContext } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { invoiceBalance, isOverdue } from "@/modules/sales/invoices";

export const metadata: Metadata = { title: "Ventes" };

export default async function SalesOverview() {
  const ctx = await requireTenantContext();
  const canInv = ctx.can("finance.invoice.read");
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [open, month, quotes, toDeliver, recent] = await Promise.all([
    canInv ? ctx.db.invoice.findMany({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, select: { dueDate: true, status: true, total: true, amountPaid: true, creditedAmount: true } }) : Promise.resolve([]),
    canInv ? ctx.db.invoice.aggregate({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] }, issueDate: { gte: monthStart } }, _sum: { total: true, subtotal: true, discountTotal: true } }) : Promise.resolve(null),
    ctx.can("sales.quote.read") ? ctx.db.quote.aggregate({ where: { status: { in: ["DRAFT", "SENT"] } }, _count: true, _sum: { total: true } }) : Promise.resolve(null),
    ctx.can("sales.order.read") ? ctx.db.salesOrder.count({ where: { status: { in: ["CONFIRMED", "PARTIALLY_DELIVERED"] } } }) : Promise.resolve(0),
    canInv ? ctx.db.invoice.findMany({ where: { status: { not: "DRAFT" } }, orderBy: [{ issuedAt: "desc" }], take: 6, include: { customer: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  const cur = ctx.company.currency;
  const outstanding = open.reduce((a, i) => a + invoiceBalance(i).toNumber(), 0);
  const overdueRows = open.filter((i) => isOverdue(i));
  const overdue = overdueRows.reduce((a, i) => a + invoiceBalance(i).toNumber(), 0);
  const monthHt = month ? num(month._sum.subtotal) - num(month._sum.discountTotal) : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {canInv && <Kpi icon={<FileText className="size-4" />} label="Facturé ce mois (HT)" value={formatMoney(monthHt, cur)} href="/app/sales/factures" />}
        {canInv && <Kpi icon={<HandCoins className="size-4" />} label="À encaisser" value={formatMoney(outstanding, cur)} hint={`${open.length} facture${open.length > 1 ? "s" : ""} ouverte${open.length > 1 ? "s" : ""}`} href="/app/sales/factures" />}
        {canInv && <Kpi icon={<AlertTriangle className="size-4" />} label="Échu" value={formatMoney(overdue, cur)} hint={`${overdueRows.length} facture${overdueRows.length > 1 ? "s" : ""} en retard`} tone={overdueRows.length ? "danger" : undefined} href="/app/sales/relances" />}
        {quotes && <Kpi icon={<FileText className="size-4" />} label="Devis en cours" value={String(quotes._count)} hint={formatMoney(num(quotes._sum.total), cur)} href="/app/sales/devis" />}
        {ctx.can("sales.order.read") && <Kpi icon={<Truck className="size-4" />} label="Commandes à livrer" value={String(toDeliver)} href="/app/sales/commandes" />}
      </div>
      {canInv && (
        <Card>
          <CardHeader><CardTitle className="text-base">Dernières factures</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {recent.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucune facture émise pour le moment.</p>}
            {recent.map((i) => (
              <Link key={i.id} href={`/app/sales/factures/${i.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{i.number} · {i.customer.name}</p><p className="text-xs text-muted-foreground">{fmtDate(i.issueDate)}</p></div>
                <span className="tabular text-sm">{formatMoney(num(i.total), cur)}</span>
                <Status value={i.status} />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
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
