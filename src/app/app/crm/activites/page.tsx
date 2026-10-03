import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDateTime } from "@/lib/format";
import { PAGE_SIZE, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { listActivities } from "@/modules/crm/service";
import { ActivityDialog } from "@/modules/crm/ui/activity-dialog";
import { ActivityRow } from "@/modules/crm/ui/activity-row";
import { ACTIVITY_TYPES } from "@/modules/crm/schemas";

export const metadata: Metadata = { title: "Activités" };

export default async function ActivitiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("crm.activity.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const scope = enumParam(sp, "portee", ["mine", "all"] as const) ?? "mine";
  const etat = enumParam(sp, "etat", ["open", "done"] as const) ?? "open";
  const { rows, total } = await listActivities(ctx, { scope, open: etat === "open", skip: lp.skip, take: lp.take });
  const label = new Map<string, string>(ACTIVITY_TYPES.map((t) => [t.value, t.label]));

  return (
    <>
      <ListToolbar
        placeholder="Activités"
        filters={[
          { name: "portee", label: "Portée", options: [{ value: "mine", label: "Les miennes" }, { value: "all", label: "Toute l'équipe" }] },
          { name: "etat", label: "État", options: [{ value: "open", label: "À faire" }, { value: "done", label: "Terminées" }] },
        ]}
      >
        {ctx.can("crm.activity.create") && <ActivityDialog />}
      </ListToolbar>
      {rows.length === 0 ? (
        <EmptyState icon={<CalendarClock className="size-8" />} title={etat === "open" ? "Rien à faire" : "Aucune activité terminée"} description="Planifiez des appels, rendez-vous et relances depuis la fiche d'un client ou ici." />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map((a) => (
            <ActivityRow
              key={a.id}
              id={a.id}
              subject={a.subject}
              typeLabel={label.get(a.type) ?? a.type}
              done={a.doneAt !== null}
              overdue={!a.doneAt && a.dueAt !== null && a.dueAt < new Date()}
              dueLabel={a.dueAt ? fmtDateTime(a.dueAt) : null}
              canEdit={ctx.can("crm.activity.update")}
              context={
                a.customer ? <Link href={`/app/crm/clients/${a.customer.id}`} className="hover:text-brand">{a.customer.name}</Link> : a.lead ? <span>{a.lead.name} (prospect)</span> : a.opportunity ? <span>{a.opportunity.title}</span> : null
              }
            />
          ))}
        </ul>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/crm/activites" searchParams={sp} />
    </>
  );
}
