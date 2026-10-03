import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ClipboardCheck, HandCoins, PackageCheck, ShoppingCart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Status } from "@/components/app/status-badge";
import { pendingDecisionCount } from "@/core/approvals";
import { num } from "@/core/money";
import { requireTenantContext } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { payablesSummary } from "@/modules/purchasing/bills";

export const metadata: Metadata = { title: "Achats" };

export default async function PurchasesOverview() {
  const ctx = await requireTenantContext();
  const canBill = ctx.can("purchases.bill.read");
  const canOrder = ctx.can("purchases.order.read");
  const [pay, openOrders, toReceive, pending, recent] = await Promise.all([
    canBill ? payablesSummary(ctx) : Promise.resolve(null),
    canOrder ? ctx.db.purchaseOrder.aggregate({ where: { status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] } }, _count: true, _sum: { total: true } }) : Promise.resolve(null),
    ctx.can("purchases.receipt.read") ? ctx.db.purchaseOrder.count({ where: { status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] } } }) : Promise.resolve(0),
    pendingDecisionCount(ctx),
    canOrder ? ctx.db.purchaseOrder.findMany({ orderBy: { createdAt: "desc" }, take: 6, include: { supplier: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  const cur = ctx.company.currency;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {pay && <Kpi icon={<HandCoins className="size-4" />} label="Dettes fournisseurs" value={formatMoney(pay.outstanding.toNumber(), cur)} hint={`${pay.count} facture${pay.count > 1 ? "s" : ""} ouverte${pay.count > 1 ? "s" : ""}`} href="/app/purchases/factures" />}
        {pay && <Kpi icon={<AlertTriangle className="size-4" />} label="Échu à payer" value={formatMoney(pay.overdue.toNumber(), cur)} tone={pay.overdue.gt(0) ? "danger" : undefined} href="/app/purchases/factures?statut=OVERDUE" />}
        {openOrders && <Kpi icon={<ShoppingCart className="size-4" />} label="Commandes en cours" value={String(openOrders._count)} hint={formatMoney(num(openOrders._sum.total), cur)} href="/app/purchases/commandes" />}
        {ctx.can("purchases.receipt.read") && <Kpi icon={<PackageCheck className="size-4" />} label="À réceptionner" value={String(toReceive)} href="/app/purchases/commandes" />}
        {pending > 0 && <Kpi icon={<ClipboardCheck className="size-4" />} label="À valider" value={String(pending)} hint="Demandes en attente de votre décision" tone="warning" href="/app/validations" />}
      </div>
      {canOrder && (
        <Card>
          <CardHeader><CardTitle className="text-base">Dernières commandes fournisseur</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {recent.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucune commande fournisseur pour le moment.</p>}
            {recent.map((o) => (
              <Link key={o.id} href={`/app/purchases/commandes/${o.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{o.number} · {o.supplier.name}</p><p className="text-xs text-muted-foreground">{fmtDate(o.orderDate)}</p></div>
                <span className="tabular text-sm">{formatMoney(num(o.total), cur)}</span>
                <Status value={o.status} />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, hint, href, tone }: { icon: React.ReactNode; label: string; value: string; hint?: string; href: string; tone?: "danger" | "warning" }) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:border-brand/50">
        <CardContent className="space-y-1 p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">{icon}{label}</div>
          <div className={`truncate text-xl font-semibold tracking-tight tabular 2xl:text-2xl ${tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : ""}`}>{value}</div>
          {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        </CardContent>
      </Card>
    </Link>
  );
}
