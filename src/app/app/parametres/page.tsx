import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireTenantContext } from "@/core/tenant/guards";
import { CompanyForm } from "./company-form";
import { LogoCard } from "./logo-card";

export const metadata: Metadata = { title: "Paramètres — Entreprise" };

export default async function CompanySettingsPage() {
  const ctx = await requireTenantContext();
  if (!ctx.can("settings.company.read")) redirect("/app/parametres/securite");
  const c = await ctx.db.company.findFirstOrThrow({ where: { id: ctx.company.id } });

  return (
    <>
    <LogoCard canEdit={ctx.can("settings.company.update")} currentUrl={c.logoUrl} />
    <CompanyForm
      readOnly={!ctx.can("settings.company.update")}
      initial={{
        legalName: c.legalName, tradeName: c.tradeName ?? "", legalForm: c.legalForm ?? "", email: c.email ?? "",
        phone: c.phone ?? "", address: c.address ?? "", city: c.city ?? "", country: c.country, rccm: c.rccm ?? "",
        taxId: c.taxId ?? "", sector: c.sector ?? "", size: c.size ?? "", currency: c.currency, timezone: c.timezone,
        fiscalYearStartMonth: c.fiscalYearStartMonth,
      }}
    />
    </>
  );
}
