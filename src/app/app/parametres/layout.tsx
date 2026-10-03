import { PageHeader } from "@/components/app/page-header";
import { requireTenantContext } from "@/core/tenant/guards";
import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenantContext();
  const tabs = [
    { href: "/app/parametres", label: "Entreprise", show: ctx.can("settings.company.read") },
    { href: "/app/parametres/utilisateurs", label: "Utilisateurs", show: ctx.can("users.member.read") },
    { href: "/app/parametres/roles", label: "Rôles et permissions", show: ctx.can("roles.role.read") },
    { href: "/app/parametres/modules", label: "Modules", show: ctx.can("settings.company.read") || ctx.can("settings.billing.read") },
    { href: "/app/parametres/organisation", label: "Organisation", show: ctx.can("org.structure.read") },
    { href: "/app/parametres/taxes", label: "Taxes", show: ctx.can("settings.company.read") },
    { href: "/app/parametres/numerotation", label: "Numérotation", show: ctx.can("settings.company.read") },
    { href: "/app/parametres/validations", label: "Validations", show: ctx.can("settings.company.read") },
    { href: "/app/parametres/audit", label: "Journal d'audit", show: ctx.can("audit.log.read") },
    { href: "/app/parametres/donnees", label: "Import / export", show: ctx.can("data.import.manage") || ctx.can("data.export.run") },
    { href: "/app/parametres/abonnement", label: "Abonnement", show: ctx.can("settings.billing.read") },
    { href: "/app/parametres/notifications", label: "Notifications", show: true },
    { href: "/app/parametres/securite", label: "Sécurité", show: true },
  ].filter((t) => t.show);

  return (
    <>
      <PageHeader title="Paramètres" description={`${ctx.company.tradeName ?? ctx.company.legalName} — configuration et compte personnel.`} />
      <SettingsNav tabs={tabs.map(({ href, label }) => ({ href, label }))} />
      <div className="mt-6">{children}</div>
    </>
  );
}
