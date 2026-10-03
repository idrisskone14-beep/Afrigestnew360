import { PageHeader } from "@/components/app/page-header";
import { TabNav } from "@/components/app/tab-nav";
import { requireModulePage } from "@/core/tenant/guards";

export default async function PurchasesLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireModulePage("purchases");
  const tabs = [
    { href: "/app/purchases", label: "Vue d'ensemble", exact: true, show: true },
    { href: "/app/purchases/fournisseurs", label: "Fournisseurs", show: ctx.can("purchases.supplier.read") },
    { href: "/app/purchases/demandes", label: "Demandes d'achat", show: ctx.can("purchases.request.read") },
    { href: "/app/purchases/commandes", label: "Commandes", show: ctx.can("purchases.order.read") },
    { href: "/app/purchases/receptions", label: "Réceptions", show: ctx.can("purchases.receipt.read") },
    { href: "/app/purchases/factures", label: "Factures fournisseur", show: ctx.can("purchases.bill.read") },
    { href: "/app/purchases/paiements", label: "Paiements", show: ctx.can("purchases.payment.read") },
  ].filter((t) => t.show);
  return (
    <>
      <PageHeader title="Achats & Fournisseurs" description="De la demande d'achat au paiement : approbations, réceptions en stock, factures et règlements fournisseurs." />
      <TabNav tabs={tabs} label="Sections des achats" />
      {children}
    </>
  );
}
