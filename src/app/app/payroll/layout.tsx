import { PageHeader } from "@/components/app/page-header";
import { TabNav } from "@/components/app/tab-nav";
import { requireModulePage } from "@/core/tenant/guards";

export default async function PayrollLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireModulePage("payroll");
  const manage = ctx.can("hr.payroll.manage");
  const tabs = [
    { href: "/app/payroll", label: "Campagnes", exact: true, show: manage },
    { href: "/app/payroll/bulletins", label: manage ? "Bulletins" : "Mes bulletins", show: manage || ctx.can("hr.payslip.read") },
    { href: "/app/payroll/rubriques", label: "Rubriques", show: manage },
  ].filter((t) => t.show);
  return (
    <>
      <PageHeader title="Paie" description="Campagnes mensuelles, rubriques paramétrables et versionnées, bulletins PDF, écritures comptables automatiques." />
      <TabNav tabs={tabs} label="Sections de la paie" />
      {children}
    </>
  );
}
