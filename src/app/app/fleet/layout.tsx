import { PageHeader } from "@/components/app/page-header";
import { TabNav } from "@/components/app/tab-nav";
import { requireModulePage } from "@/core/tenant/guards";

export default async function FleetLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireModulePage("fleet");
  const tabs = [
    { href: "/app/fleet", label: "Vue d'ensemble", exact: true, show: ctx.can("fleet.vehicle.read") },
    { href: "/app/fleet/vehicules", label: "Véhicules", show: ctx.can("fleet.vehicle.read") },
    { href: "/app/fleet/chauffeurs", label: "Chauffeurs", show: ctx.can("fleet.vehicle.read") || ctx.can("fleet.driver.manage") },
    { href: "/app/fleet/missions", label: "Missions", show: ctx.can("fleet.vehicle.read") || ctx.can("fleet.trip.manage") },
    { href: "/app/fleet/carburant", label: "Carburant", show: ctx.can("fleet.vehicle.read") || ctx.can("fleet.fuel.manage") },
    { href: "/app/fleet/entretiens", label: "Entretiens", show: ctx.can("fleet.vehicle.read") || ctx.can("fleet.maintenance.manage") },
    { href: "/app/fleet/contraventions", label: "Contraventions", show: ctx.can("fleet.fine.read") },
  ].filter((t) => t.show);
  return (
    <>
      <PageHeader title="Transport & Flotte" description="Véhicules, chauffeurs, missions, carburant, entretiens, assurances, contraventions, coûts et rentabilité." />
      <TabNav tabs={tabs} label="Sections de la flotte" />
      {children}
    </>
  );
}
