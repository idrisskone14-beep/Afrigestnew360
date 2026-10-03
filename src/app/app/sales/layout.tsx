import { PageHeader } from "@/components/app/page-header";
import { TabNav } from "@/components/app/tab-nav";
import { requireModulePage } from "@/core/tenant/guards";

export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireModulePage("sales");
  const tabs = [
    { href: "/app/sales", label: "Vue d'ensemble", exact: true, show: true },
    { href: "/app/sales/devis", label: "Devis", show: ctx.can("sales.quote.read") },
    { href: "/app/sales/commandes", label: "Commandes", show: ctx.can("sales.order.read") },
    { href: "/app/sales/livraisons", label: "Livraisons", show: ctx.can("sales.delivery.read") },
    { href: "/app/sales/factures", label: "Factures", show: ctx.can("finance.invoice.read") },
    { href: "/app/sales/paiements", label: "Paiements", show: ctx.can("finance.payment.read") },
    { href: "/app/sales/avoirs", label: "Avoirs", show: ctx.can("finance.credit_note.read") },
    { href: "/app/sales/relances", label: "Relances", show: ctx.can("finance.invoice.read") },
  ].filter((t) => t.show);
  return (
    <>
      <PageHeader title="Ventes & Facturation" description="Du devis au paiement : commandes, livraisons, factures, avoirs et relances." />
      <TabNav tabs={tabs} label="Sections des ventes" />
      {children}
    </>
  );
}
