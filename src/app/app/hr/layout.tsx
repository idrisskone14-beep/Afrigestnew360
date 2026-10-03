import { PageHeader } from "@/components/app/page-header";
import { TabNav } from "@/components/app/tab-nav";
import { requireModulePage } from "@/core/tenant/guards";

export default async function HrLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireModulePage("hr");
  const tabs = [
    { href: "/app/hr", label: "Vue d'ensemble", exact: true, show: true },
    { href: "/app/hr/salaries", label: "Salariés", show: ctx.can("hr.employee.read") },
    { href: "/app/hr/conges", label: "Congés", show: ctx.can("hr.leave.read") || ctx.can("hr.leave.request") },
    { href: "/app/hr/presences", label: "Présences", show: ctx.can("hr.attendance.read") },
  ].filter((t) => t.show);
  return (
    <>
      <PageHeader title="Ressources humaines" description="Salariés, contrats, congés avec validation, présences, évaluations et formations." />
      <TabNav tabs={tabs} label="Sections des ressources humaines" />
      {children}
    </>
  );
}
