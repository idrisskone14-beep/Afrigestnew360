import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { StatusBadge } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { APPROVAL_TYPES, canDecideRequest, isApprovalType, listApprovals } from "@/core/approvals";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PAGE_SIZE, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { DecisionButtons } from "@/modules/purchasing/ui/purchase-dialogs";

export const metadata: Metadata = { title: "Validations" };
const TONE = { PENDING: "warning", APPROVED: "success", REJECTED: "danger", CANCELLED: "neutral" } as const;
const LABEL = { PENDING: "En attente", APPROVED: "Validée", REJECTED: "Refusée", CANCELLED: "Annulée" } as const;

export default async function ValidationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("workflow.request.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const) ?? "PENDING";
  const { rows, total } = await listApprovals(ctx, { status, skip: lp.skip, take: lp.take });
  const people = new Map((await ctx.db.companyMembership.findMany({ where: { userId: { in: [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById, ...r.decisions.map((x) => x.decidedById)].filter((x): x is string => Boolean(x))))] } }, select: { userId: true, user: { select: { name: true } } } })).map((m) => [m.userId, m.user.name]));
  const tabs = [{ key: "PENDING", label: "À traiter" }, { key: "APPROVED", label: "Validées" }, { key: "REJECTED", label: "Refusées" }, { key: "CANCELLED", label: "Annulées" }];

  return (
    <>
      <PageHeader title="Validations" description="Demandes en attente de votre décision et historique des décisions de l'entreprise." />
      <nav aria-label="Statut des validations" className="-mx-1 mb-6 overflow-x-auto border-b">
        <ul className="flex min-w-max gap-1 px-1">
          {tabs.map((t) => (
            <li key={t.key}>
              <Link href={`/app/validations?statut=${t.key}`} aria-current={status === t.key ? "page" : undefined}
                className={cn("relative inline-block px-3 py-2.5 text-sm font-medium transition-colors", status === t.key ? "text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand" : "text-muted-foreground hover:text-foreground")}>{t.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="space-y-3">
        {rows.length === 0 ? <EmptyState icon={<ClipboardCheck className="size-8" />} title={status === "PENDING" ? "Rien à valider" : "Aucune demande"} description={status === "PENDING" ? "Les demandes dépassant le seuil défini par l'entreprise apparaîtront ici." : "Aucune demande avec ce statut."} /> : (
          <Card className="divide-y p-0">
            {rows.map((r) => {
              const type = isApprovalType(r.resourceType) ? r.resourceType : null;
              const meta = type ? APPROVAL_TYPES[type] : null;
              const mayDecide = type !== null && canDecideRequest(ctx, r);
              const chain = r.totalSteps > 1 || r.ruleId !== null;
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{meta ? <Link href={`${meta.href}/${r.resourceId}`} className="hover:text-brand">{r.title}</Link> : r.title}</p>
                    <p className="text-xs text-muted-foreground">{meta?.label ?? r.resourceType} · demandé par {people.get(r.requestedById) ?? "—"} le {fmtDateTime(r.createdAt)}{r.decidedAt ? ` · décidé par ${people.get(r.decidedById ?? "") ?? "—"} le ${fmtDateTime(r.decidedAt)}` : ""}</p>
                    {chain && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {r.rule?.name ? `Règle « ${r.rule.name} » · ` : ""}
                        {r.status === "PENDING" ? <span className="font-medium text-foreground">Étape {r.currentStep}/{r.totalSteps}{r.currentLabel ? ` — ${r.currentLabel}` : ""}</span> : `${r.totalSteps} étape${r.totalSteps > 1 ? "s" : ""}`}
                      </p>
                    )}
                    {r.decisions.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs" aria-label="Décisions">
                        {r.decisions.map((x) => (
                          <li key={x.step}>
                            <span className={x.decision === "APPROVED" ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}>{x.decision === "APPROVED" ? "✓ Validé" : "✗ Refusé"}</span>
                            {" "}— étape {x.step}{r.rule?.steps.find((st) => st.stepOrder === x.step)?.label ? ` (${r.rule.steps.find((st) => st.stepOrder === x.step)!.label})` : ""} par {people.get(x.decidedById) ?? "—"}, {fmtDateTime(x.decidedAt)}{x.comment ? ` : « ${x.comment} »` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    {!r.decisions.length && r.comment && <p className="mt-0.5 text-xs">« {r.comment} »</p>}
                  </div>
                  <span className="tabular text-sm font-medium">{r.resourceType === "leave" ? `${num(r.amount)} j` : formatMoney(num(r.amount), r.currency)}</span>
                  {mayDecide ? <DecisionButtons id={r.id} title={r.title} /> : <StatusBadge tone={TONE[r.status]}>{LABEL[r.status]}</StatusBadge>}
                  {r.status === "PENDING" && r.requestedById === ctx.user.id && <span className="text-xs text-muted-foreground">Votre demande</span>}
                </div>
              );
            })}
          </Card>
        )}
        <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/validations" searchParams={sp} />
      </div>
    </>
  );
}
