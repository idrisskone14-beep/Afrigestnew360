import { ModuleHeader } from "@/components/app/module-header";
import { requireModulePage } from "@/core/tenant/guards";

export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  await requireModulePage("sales");
  return (
    <>
      <ModuleHeader />
      {children}
    </>
  );
}
