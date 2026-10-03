import { PageHeader } from "@/components/app/page-header";
import { requireModulePage } from "@/core/tenant/guards";

export default async function ConstructionLayout({ children }: { children: React.ReactNode }) {
  await requireModulePage("construction");
  return (
    <>
      <PageHeader title="Gestion de chantiers" description="Chantiers, équipes, matériel, matériaux (stock), sous-traitants, budget réel, avancement et rapports terrain." />
      {children}
    </>
  );
}
