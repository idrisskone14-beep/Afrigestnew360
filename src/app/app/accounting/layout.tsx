import { PageHeader } from "@/components/app/page-header";
import { TabNav } from "@/components/app/tab-nav";
import { requireModulePage } from "@/core/tenant/guards";

export default async function AccountingLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireModulePage("accounting");
  const tabs = [
    { href: "/app/accounting", label: "Vue d'ensemble", exact: true, show: true },
    { href: "/app/accounting/ecritures", label: "Écritures", show: ctx.can("accounting.entry.read") },
    { href: "/app/accounting/grand-livre", label: "Grand livre", show: ctx.can("accounting.ledger.read") },
    { href: "/app/accounting/balance", label: "Balance", show: ctx.can("accounting.ledger.read") },
    { href: "/app/accounting/etats", label: "États financiers", show: ctx.can("accounting.ledger.read") },
    { href: "/app/accounting/plan", label: "Plan comptable", show: ctx.can("accounting.chart.read") },
    { href: "/app/accounting/exercices", label: "Exercices", show: ctx.can("accounting.ledger.read") },
  ].filter((t) => t.show);
  return (
    <>
      <PageHeader title="Comptabilité" description="Plan comptable compatible SYSCOHADA, écritures automatiques, grand livre, balance et états financiers." />
      <TabNav tabs={tabs} label="Sections de la comptabilité" />
      {children}
    </>
  );
}
