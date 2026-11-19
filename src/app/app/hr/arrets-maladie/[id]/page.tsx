import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { z } from "zod";
import { Info } from "@/components/app/info-item";
import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppError } from "@/core/errors";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { EntityDocuments } from "@/modules/documents/ui/entity-documents";
import { CERTIFICATE_STATUSES, SICK_STATUSES } from "@/modules/hr/registers-schemas";
import { getSickLeave, sickAlerts, sickCalendarDays } from "@/modules/hr/sickleave";
import { loadPolicy } from "@/modules/hr/policy";
import { ExtendSickDialog, ReturnSickDialog, SickLeaveDialog } from "@/modules/hr/ui/register-dialogs";

export const metadata: Metadata = { title: "Arrêt maladie" };
const label = (list: readonly { value: string; label: string }[], v: string) => list.find((x) => x.value === v)?.label ?? v;

export default async function SickLeaveDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireModulePage("hr");
  if (!ctx.can("hr.sickleave.read")) forbidden();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const r = await getSickLeave(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const policy = await loadPolicy(ctx.db);
  const alerts = sickAlerts(r, new Date(), policy.sickReturnAlertDays);
  const manage = ctx.can("hr.sickleave.manage");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground"><Link href="/app/hr/arrets-maladie" className="hover:text-foreground">Arrêts maladie</Link> / {r.employee.number}</p>
          <h2 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">{r.employee.firstName} {r.employee.lastName} <StatusBadge tone={r.status === "ONGOING" ? "info" : r.status === "ENDED" ? "success" : "neutral"}>{label(SICK_STATUSES, r.status)}</StatusBadge></h2>
        </div>
        {manage && r.status === "ONGOING" && (
          <div className="flex flex-wrap gap-2">
            <SickLeaveDialog sick={r} />
            <ExtendSickDialog id={r.id} currentEnd={r.expectedEndDate} />
            <ReturnSickDialog id={r.id} expectedEnd={r.expectedEndDate} />
          </div>
        )}
      </div>
      {alerts.length > 0 && <Card className="border-amber-300/60 bg-amber-50/50 p-4 text-sm dark:border-amber-500/30 dark:bg-amber-500/5">{alerts.map((a) => <p key={a.code}>• {a.message}</p>)}</Card>}
      <Card><CardHeader><CardTitle className="text-base">Arrêt</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3">
        <Info label="Premier jour">{fmtDate(r.startDate)}</Info>
        <Info label="Fin prévue">{fmtDate(r.expectedEndDate)}</Info>
        <Info label="Reprise effective">{r.returnDate ? fmtDate(r.returnDate) : "—"}</Info>
        <Info label="Durée">{sickCalendarDays(r)} jour(s) calendaires</Info>
        <Info label="Justificatif médical">{label(CERTIFICATE_STATUSES, r.certificate)}</Info>
        <div className="sm:col-span-3"><Info label="Observations administratives"><span className="whitespace-pre-line">{r.observations ?? "—"}</span></Info></div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Prolongations</CardTitle></CardHeader><CardContent>
        {r.extensions.length === 0 ? <p className="text-sm text-muted-foreground">Aucune prolongation.</p> : (
          <ul className="divide-y text-sm">{r.extensions.map((x) => <li key={x.id} className="flex flex-wrap justify-between gap-2 py-2"><span>Fin prévue {fmtDate(x.previousEnd)} → <b>{fmtDate(x.newEnd)}</b>{x.note ? ` — ${x.note}` : ""}</span><span className="text-xs text-muted-foreground">enregistré le {fmtDate(x.createdAt)}</span></li>)}</ul>
        )}
      </CardContent></Card>
      <EntityDocuments ctx={ctx} type="hr_sickleave" id={r.id} />
      {!ctx.hasModule("documents") && <p className="text-xs text-muted-foreground">Activez le module Documents pour joindre le certificat (accès restreint aux profils « arrêts maladie »).</p>}
    </div>
  );
}
