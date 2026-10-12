import { ModuleHeader } from "@/components/app/module-header";
import { requireModulePage } from "@/core/tenant/guards";

export default async function ConstructionLayout({ children }: { children: React.ReactNode }) {
  await requireModulePage("construction");
  return (
    <>
      <ModuleHeader />
      {children}
    </>
  );
}
