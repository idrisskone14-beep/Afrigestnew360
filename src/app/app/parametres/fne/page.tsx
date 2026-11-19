import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/core/tenant/guards";
import { fneFeatureEnabled } from "@/modules/sales/fne/client";
import { fneSettingsView } from "@/modules/sales/fne/service";
import { FneSettingsForm } from "@/modules/sales/fne/ui";

export const metadata: Metadata = { title: "Paramètres — Facture normalisée électronique (FNE)" };

export default async function FneSettingsPage() {
  const ctx = await requirePagePermission("settings.company.read");
  if (!fneFeatureEnabled() || !ctx.hasModule("sales")) notFound();
  const v = await fneSettingsView(ctx);
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Côte d&apos;Ivoire : la loi de finances 2025 impose la facture normalisée électronique. KAKO Gestion transmet vos factures et avoirs à la plateforme FNE de la DGI,
        qui les certifie (numéro FNE et QR code de vérification imprimés sur le PDF).
      </p>
      <FneSettingsForm canManage={ctx.can("settings.company.update")} initial={{ ...v, stickerCheckedAt: v.stickerCheckedAt?.toISOString() ?? null }} />
    </div>
  );
}
