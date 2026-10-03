import type { Metadata } from "next";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { pipelineBoard } from "@/modules/crm/service";
import { PipelineBoard } from "@/modules/crm/ui/pipeline-board";

export const metadata: Metadata = { title: "Opportunités" };

export default async function OpportunitiesPage() {
  const ctx = await requirePagePermission("crm.opportunity.read");
  const [{ stages, opps }, customers] = await Promise.all([
    pipelineBoard(ctx),
    ctx.can("crm.customer.read") ? ctx.db.customer.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }) : Promise.resolve([]),
  ]);
  return (
    <PipelineBoard
      currency={ctx.company.currency}
      customers={customers}
      can={{ create: ctx.can("crm.opportunity.create"), update: ctx.can("crm.opportunity.update"), delete: ctx.can("crm.opportunity.delete") }}
      stages={stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, probability: s.probability }))}
      opps={opps.map((o) => ({
        id: o.id, title: o.title, stageId: o.stageId, amount: num(o.amount), customerId: o.customerId, customerName: o.customer?.name ?? o.lead?.name ?? null,
        expectedCloseDate: o.expectedCloseDate?.toISOString() ?? null, notes: o.notes, lostReason: o.lostReason,
      }))}
    />
  );
}
