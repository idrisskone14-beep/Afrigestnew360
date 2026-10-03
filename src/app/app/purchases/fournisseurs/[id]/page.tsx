import type { Metadata } from "next";
import { EntityDocuments } from "@/modules/documents/ui/entity-documents";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Archive, Mail, MapPin, Phone } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { Status, StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppError } from "@/core/errors";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { countryName, formatMoney } from "@/lib/reference-data";
import { archiveSupplierAction } from "@/modules/purchasing/actions";
import { billBalance, isBillOverdue } from "@/modules/purchasing/bills";
import { getSupplier } from "@/modules/purchasing/suppliers";
import { SupplierFormDialog } from "@/modules/purchasing/ui/supplier-form";

export const metadata: Metadata = { title: "Fiche fournisseur" };

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("purchases.supplier.read");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const s = await getSupplier(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const cur = ctx.company.currency;
  const canOrders = ctx.can("purchases.order.read");
  const canBills = ctx.can("purchases.bill.read");
  const [orders, bills] = await Promise.all([
    canOrders ? ctx.db.purchaseOrder.findMany({ where: { supplierId: id }, orderBy: { createdAt: "desc" }, take: 8 }) : Promise.resolve([]),
    canBills ? ctx.db.supplierBill.findMany({ where: { supplierId: id }, orderBy: { billDate: "desc" }, take: 50 }) : Promise.resolve([]),
  ]);
  const open = bills.filter((b) => b.status === "POSTED" || b.status === "PARTIALLY_PAID");
  const outstanding = open.reduce((a, b) => a + billBalance(b).toNumber(), 0);
  const overdue = open.filter(isBillOverdue).reduce((a, b) => a + billBalance(b).toNumber(), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground"><Link href="/app/purchases/fournisseurs" className="hover:text-foreground">Fournisseurs</Link> / {s.code}</p>
          <h2 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">{s.name} <StatusBadge tone={s.isActive ? "success" : "neutral"}>{s.isActive ? "Actif" : "Inactif"}</StatusBadge></h2>
        </div>
        <div className="flex gap-2">
          {ctx.can("purchases.supplier.update") && (
            <SupplierFormDialog supplierId={s.id} isActive={s.isActive} initial={{ name: s.name, email: s.email ?? "", phone: s.phone ?? "", address: s.address ?? "", city: s.city ?? "", country: s.country ?? "", taxId: s.taxId ?? "", rccm: s.rccm ?? "", paymentTermsDays: s.paymentTermsDays, notes: s.notes ?? "" }} />
          )}
          {ctx.can("purchases.supplier.delete") && <ActionButton action={archiveSupplierAction} input={{ id: s.id }} label="Archiver" icon={<Archive className="size-4" />} variant="outline" className="text-destructive hover:text-destructive" success="Fournisseur archivé" redirectTo="/app/purchases/fournisseurs" confirm={{ title: `Archiver ${s.name} ?`, description: "Le fournisseur disparaît des listes mais son historique est conservé. L'archivage est refusé s'il reste des factures à payer.", confirmLabel: "Archiver" }} />}
        </div>
      </div>

      {canBills && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card><CardContent className="space-y-1 p-5"><p className="text-sm text-muted-foreground">Dette en cours</p><p className="text-2xl font-semibold tabular">{formatMoney(outstanding, cur)}</p></CardContent></Card>
          <Card><CardContent className="space-y-1 p-5"><p className="text-sm text-muted-foreground">Dont échu</p><p className={`text-2xl font-semibold tabular ${overdue > 0 ? "text-destructive" : ""}`}>{formatMoney(overdue, cur)}</p></CardContent></Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Coordonnées</CardTitle></CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <p className="flex items-center gap-2"><Mail className="size-4 text-muted-foreground" />{s.email ? <a href={`mailto:${s.email}`} className="hover:text-brand">{s.email}</a> : "—"}</p>
            <p className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" />{s.phone ?? "—"}</p>
            <p className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" />{[s.address, s.city, s.country ? countryName(s.country) : null].filter(Boolean).join(", ") || "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Conditions</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <Info label="Délai de paiement">{s.paymentTermsDays} jours</Info>
            <Info label="Identifiant fiscal">{s.taxId ?? "—"}</Info>
            <Info label="RCCM">{s.rccm ?? "—"}</Info>
            <Info label="Fournisseur depuis">{fmtDate(s.createdAt)}</Info>
          </CardContent>
        </Card>
      </div>

      {canOrders && (
        <Card>
          <CardHeader><CardTitle className="text-base">Commandes récentes</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {orders.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucune commande.</p>}
            {orders.map((o) => (
              <Link key={o.id} href={`/app/purchases/commandes/${o.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50"><span className="flex-1 text-sm font-medium">{o.number}</span><span className="text-xs text-muted-foreground">{fmtDate(o.orderDate)}</span><span className="tabular text-sm">{formatMoney(num(o.total), o.currency)}</span><Status value={o.status} /></Link>
            ))}
          </CardContent>
        </Card>
      )}
      {s.notes && <Card><CardContent className="p-4 text-sm"><p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Notes</p>{s.notes}</CardContent></Card>}
      <EntityDocuments ctx={ctx} type="supplier" id={id} />
    </div>
  );
}

const Info = ({ label, children }: { label: string; children: React.ReactNode }) => <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium">{children}</p></div>;
