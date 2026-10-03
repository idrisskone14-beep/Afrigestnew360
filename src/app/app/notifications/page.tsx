import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { NOTIFICATION_CATALOG } from "@/core/notification-catalog";
import { requireTenantContext } from "@/core/tenant/guards";
import { PAGE_SIZE, buildQuery, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { MarkAllButton, NotificationItem } from "./notification-controls";

export const metadata: Metadata = { title: "Notifications" };

const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const TYPES = NOTIFICATION_CATALOG.map((t) => t.type);

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireTenantContext();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const unreadOnly = enumParam(sp, "filtre", ["non-lues"] as const) === "non-lues";
  const type = enumParam(sp, "type", TYPES);
  // les notifications sont personnelles : toujours bornées à l'utilisateur courant (et à l'entreprise active par ctx.db)
  const where = { userId: ctx.user.id, ...(unreadOnly ? { status: "UNREAD" as const } : {}), ...(type ? { type } : {}) };

  const [items, total, unread, kinds] = await Promise.all([
    ctx.db.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: lp.skip, take: lp.take }),
    ctx.db.notification.count({ where }),
    ctx.db.notification.count({ where: { userId: ctx.user.id, status: "UNREAD" } }),
    ctx.db.notification.findMany({ where: { userId: ctx.user.id }, distinct: ["type"], select: { type: true } }),
  ]);
  const labelOf = (t: string) => NOTIFICATION_CATALOG.find((c) => c.type === t)?.label ?? t;
  const link = (patch: Record<string, string | undefined>) => `/app/notifications${buildQuery(sp, { page: undefined, ...patch })}`;

  return (
    <>
      <PageHeader title="Notifications" description={`${unread} non lue${unread > 1 ? "s" : ""}`} actions={unread > 0 ? <MarkAllButton /> : undefined} />
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="flex gap-2">
          <Link href={link({ filtre: undefined })} className={!unreadOnly ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}>Toutes</Link>
          <span className="text-muted-foreground">·</span>
          <Link href={link({ filtre: "non-lues" })} className={unreadOnly ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}>Non lues</Link>
        </span>
        {kinds.length > 1 && (
          <span className="flex flex-wrap items-center gap-2" aria-label="Filtrer par type">
            <Link href={link({ type: undefined })} className={!type ? "rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium" : "rounded-full px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"}>Tous les types</Link>
            {kinds.map((k) => <Link key={k.type} href={link({ type: k.type })} className={type === k.type ? "rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium" : "rounded-full px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"}>{labelOf(k.type)}</Link>)}
          </span>
        )}
        <span className="ml-auto text-muted-foreground"><Link href="/app/parametres/notifications" className="hover:text-foreground">Préférences</Link></span>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={<Bell className="size-8" />} title="Rien à signaler" description="Vos alertes (factures échues, stocks faibles, validations, échéances…) apparaîtront ici." />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {items.map((n) => (
            <NotificationItem key={n.id} id={n.id} title={n.title} body={n.body} link={n.link} unread={n.status === "UNREAD"} date={fmt.format(n.createdAt)} />
          ))}
        </ul>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/notifications" searchParams={sp} />
    </>
  );
}
