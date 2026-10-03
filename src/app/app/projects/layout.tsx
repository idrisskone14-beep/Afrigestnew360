import { PageHeader } from "@/components/app/page-header";
import { TabNav } from "@/components/app/tab-nav";
import { requireModulePage } from "@/core/tenant/guards";

export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireModulePage("projects");
  const tabs = [
    { href: "/app/projects", label: "Projets", exact: true, show: ctx.can("project.project.read") },
    { href: "/app/projects/mes-taches", label: "Mes tâches", show: ctx.can("project.task.manage") },
    { href: "/app/projects/temps", label: "Temps passé", show: ctx.can("project.time.manage") || ctx.can("project.task.manage") },
  ].filter((t) => t.show);
  return (
    <>
      <PageHeader title="Projets & Tâches" description="Projets, tâches (Kanban et Gantt), temps passé, coûts rattachés, budget et facturation du temps." />
      <TabNav tabs={tabs} label="Sections des projets" />
      {children}
    </>
  );
}
