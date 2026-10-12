import { ModuleHeader } from "@/components/app/module-header";
import { requireModulePage } from "@/core/tenant/guards";

export default async function PayrollLayout({ children }: { children: React.ReactNode }) {
  await requireModulePage("payroll");
  return (
    <>
      <ModuleHeader />
      {children}
    </>
  );
}
