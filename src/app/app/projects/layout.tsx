import { ModuleHeader } from "@/components/app/module-header";
import { requireModulePage } from "@/core/tenant/guards";

export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  await requireModulePage("projects");
  return (
    <>
      <ModuleHeader />
      {children}
    </>
  );
}
