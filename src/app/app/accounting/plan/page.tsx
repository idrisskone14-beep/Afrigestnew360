import type { Metadata } from "next";
import { requirePagePermission } from "@/core/tenant/guards";
import { listLedgerAccounts, listMappings } from "@/modules/accounting/service";
import { ChartPanel, MappingsPanel } from "@/modules/accounting/ui/chart-panels";

export const metadata: Metadata = { title: "Plan comptable" };

export default async function ChartPage() {
  const ctx = await requirePagePermission("accounting.chart.read");
  const [accounts, mappings] = await Promise.all([listLedgerAccounts(ctx, { includeInactive: true }), listMappings(ctx)]);
  const rows = accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, class: a.class, isActive: a.isActive }));
  const canManage = ctx.can("accounting.chart.manage");
  return (
    <div className="space-y-8">
      <MappingsPanel canManage={canManage} accounts={rows} mappings={mappings.map((m) => ({ key: m.key, label: m.label, expectedClass: m.expectedClass, accountId: m.account?.id ?? null }))} />
      <ChartPanel canManage={canManage} accounts={rows} />
    </div>
  );
}
