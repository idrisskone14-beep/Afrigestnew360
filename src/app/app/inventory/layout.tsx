import { ModuleHeader } from "@/components/app/module-header";
import { requireModulePage } from "@/core/tenant/guards";

export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  await requireModulePage("inventory");
  return (
    <>
      <ModuleHeader />
      {children}
    </>
  );
}
