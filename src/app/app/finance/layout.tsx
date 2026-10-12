import { ModuleHeader } from "@/components/app/module-header";
import { requireModulePage } from "@/core/tenant/guards";

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  await requireModulePage("finance");
  return (
    <>
      <ModuleHeader />
      {children}
    </>
  );
}
