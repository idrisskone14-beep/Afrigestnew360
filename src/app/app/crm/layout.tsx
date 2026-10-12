import { ModuleHeader } from "@/components/app/module-header";
import { requireModulePage } from "@/core/tenant/guards";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  await requireModulePage("crm");
  return (
    <>
      <ModuleHeader />
      {children}
    </>
  );
}
