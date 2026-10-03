import type { Metadata } from "next";
import { requirePagePermission } from "@/core/tenant/guards";
import { listStages } from "@/modules/crm/service";
import { PipelineSettings } from "@/modules/crm/ui/pipeline-settings";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelineConfigPage() {
  const ctx = await requirePagePermission("crm.pipeline.manage");
  const stages = await listStages(ctx);
  const counts = await ctx.db.opportunity.groupBy({ by: ["stageId"], where: { deletedAt: null }, _count: { _all: true } });
  const byStage = new Map(counts.map((c) => [c.stageId, c._count._all]));
  return <PipelineSettings stages={stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability, kind: s.kind, opportunities: byStage.get(s.id) ?? 0 }))} />;
}
