import { ModuleHeader } from "@/components/app/module-header";
import { requireModulePage } from "@/core/tenant/guards";

export default async function HrLayout({ children }: { children: React.ReactNode }) {
  await requireModulePage("hr");
  return (
    <>
      <ModuleHeader />
      {children}
    </>
  );
}
