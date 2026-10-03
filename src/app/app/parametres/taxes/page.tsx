import type { Metadata } from "next";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { listTaxes } from "@/modules/settings/config";
import { TaxesPanel } from "./taxes-panel";

export const metadata: Metadata = { title: "Paramètres — Taxes" };

export default async function TaxesPage() {
  const ctx = await requirePagePermission("settings.company.read");
  const taxes = await listTaxes(ctx);
  return <TaxesPanel canManage={ctx.can("settings.tax.manage")} taxes={taxes.map((t) => ({ id: t.id, name: t.name, rate: num(t.rate), isDefault: t.isDefault, isActive: t.isActive }))} />;
}
