import { ModuleHeader } from "@/components/app/module-header";
import { requireModulePage } from "@/core/tenant/guards";

export default async function AccountingLayout({ children }: { children: React.ReactNode }) {
  await requireModulePage("accounting");
  return (
    <>
      <ModuleHeader />
      {children}
    </>
  );
}
