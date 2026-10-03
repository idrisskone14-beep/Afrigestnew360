import { PageHeader } from "@/components/app/page-header";
import { TabNav } from "@/components/app/tab-nav";
import { requireModulePage } from "@/core/tenant/guards";

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireModulePage("finance");
  const tabs = [
    { href: "/app/finance", label: "Vue d'ensemble", exact: true, show: true },
    { href: "/app/finance/comptes", label: "Comptes", show: ctx.can("finance.account.read") },
    { href: "/app/finance/mouvements", label: "Mouvements", show: ctx.can("finance.account.read") },
    { href: "/app/finance/depenses", label: "Dépenses", show: ctx.can("finance.expense.read") },
    { href: "/app/finance/echeancier", label: "Échéancier", show: ctx.can("finance.account.read") },
    { href: "/app/finance/budgets", label: "Budgets", show: ctx.can("finance.budget.read") },
    { href: "/app/finance/categories", label: "Catégories", show: ctx.can("finance.account.read") || ctx.can("finance.category.manage") },
  ].filter((t) => t.show);
  return (
    <>
      <PageHeader title="Finance" description="Trésorerie, comptes, dépenses, échéancier et budgets de l'entreprise." />
      <TabNav tabs={tabs} label="Sections de la finance" />
      {children}
    </>
  );
}
