import { PageHeader } from "@/components/app/page-header";
import { TabNav } from "@/components/app/tab-nav";
import { requireModulePage } from "@/core/tenant/guards";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireModulePage("crm");
  const tabs = [
    { href: "/app/crm", label: "Vue d'ensemble", exact: true, show: true },
    { href: "/app/crm/clients", label: "Clients", show: ctx.can("crm.customer.read") },
    { href: "/app/crm/prospects", label: "Prospects", show: ctx.can("crm.lead.read") },
    { href: "/app/crm/opportunites", label: "Opportunités", show: ctx.can("crm.opportunity.read") },
    { href: "/app/crm/activites", label: "Activités", show: ctx.can("crm.activity.read") },
    { href: "/app/crm/pipeline", label: "Pipeline", show: ctx.can("crm.pipeline.manage") },
  ].filter((t) => t.show);
  return (
    <>
      <PageHeader title="CRM & Clients" description="Prospects, clients, opportunités et suivi commercial." />
      <TabNav tabs={tabs} label="Sections du CRM" />
      {children}
    </>
  );
}
