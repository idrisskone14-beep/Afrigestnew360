import { ModuleHeader } from "@/components/app/module-header";
import { requireModulePage } from "@/core/tenant/guards";

export default async function FleetLayout({ children }: { children: React.ReactNode }) {
  await requireModulePage("fleet");
  return (
    <>
      <ModuleHeader />
      {children}
    </>
  );
}
