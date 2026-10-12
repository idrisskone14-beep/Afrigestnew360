import { ModuleHeader } from "@/components/app/module-header";
import { requireModulePage } from "@/core/tenant/guards";

export default async function PurchasesLayout({ children }: { children: React.ReactNode }) {
  await requireModulePage("purchases");
  return (
    <>
      <ModuleHeader />
      {children}
    </>
  );
}
