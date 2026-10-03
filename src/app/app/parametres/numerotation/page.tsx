import type { Metadata } from "next";
import { requirePagePermission } from "@/core/tenant/guards";
import { listNumbering } from "@/modules/settings/config";
import { NumberingPanel } from "./numbering-panel";

export const metadata: Metadata = { title: "Paramètres — Numérotation" };

export default async function NumberingPage() {
  const ctx = await requirePagePermission("settings.company.read");
  return <NumberingPanel canManage={ctx.can("settings.numbering.manage")} rows={await listNumbering(ctx)} />;
}
