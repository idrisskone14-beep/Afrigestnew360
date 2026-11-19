import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { z } from "zod";
import { FileDown } from "lucide-react";
import { Info } from "@/components/app/info-item";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppError } from "@/core/errors";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { EntityDocuments } from "@/modules/documents/ui/entity-documents";
import { DISCIPLINE_STATUSES, STEP_KINDS } from "@/modules/hr/admin-schemas";
import { getCase, listSanctionTypes, logCaseView } from "@/modules/hr/sanctions";
import { CaseDialog, CloseCaseDialog, DecideDialog, NotifyDialog, StepDialog } from "@/modules/hr/ui/admin-dialogs";

export const metadata: Metadata = { title: "Dossier disciplinaire" };
const Text = ({ children }: { children: string | null }) => <span className="whitespace-pre-line">{children || "—"}</span>;

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireModulePage("hr");
  if (!ctx.can("hr.sanction.read")) forbidden();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const c = await getCase(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  await logCaseView(ctx, c);
  const manage = ctx.can("hr.sanction.manage");
  const types = manage && c.status === "OPEN" ? await listSanctionTypes(ctx) : [];
  const label = DISCIPLINE_STATUSES.find((s) => s.value === c.status)?.label;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground"><Link href="/app/hr/sanctions" className="hover:text-foreground">Sanctions disciplinaires</Link> / {c.number}</p>
          <h2 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">{c.number} <StatusBadge tone={c.status === "OPEN" ? "info" : c.status === "DECIDED" ? "warning" : c.status === "NOTIFIED" ? "success" : "neutral"}>{label}</StatusBadge></h2>
          <p className="text-sm text-muted-foreground">{c.employeeName} ({c.employeeNumber}) · {c.breachNature}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><a href={`/api/pdf/hr_sanction/${c.id}`} target="_blank" rel="noreferrer"><FileDown className="size-4" /> Fiche PDF</a></Button>
          {manage && c.status === "OPEN" && <><CaseDialog c={c} /><StepDialog caseId={c.id} /><DecideDialog id={c.id} types={types.map((t) => ({ value: t.id, label: `${t.name}${t.requiresHearing ? " (audition exigée)" : ""}` }))} /><CloseCaseDialog id={c.id} mode="close" /></>}
          {manage && c.status === "DECIDED" && <><NotifyDialog id={c.id} /><CloseCaseDialog id={c.id} mode="cancel" /></>}
          {manage && c.status === "OPEN" && <CloseCaseDialog id={c.id} mode="cancel" />}
        </div>
      </div>
      <Card><CardHeader><CardTitle className="text-base">Les faits</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3">
        <Info label="Date des faits">{fmtDate(c.factsDate)}</Info><Info label="Nature du manquement">{c.breachNature}</Info><Info label="Responsable du dossier">{c.responsibleName ?? "—"}</Info>
        <div className="sm:col-span-3"><Info label="Description"><Text>{c.description}</Text></Info></div>
        <div className="sm:col-span-3"><Info label="Procédure suivie"><Text>{c.procedureNote}</Text></Info></div>
        <div className="sm:col-span-3"><Info label="Observations"><Text>{c.observations}</Text></Info></div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Décision</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3">
        <Info label="Sanction">{c.sanctionType?.name ?? "—"}</Info><Info label="Date de décision">{c.decisionDate ? fmtDate(c.decisionDate) : "—"}</Info><Info label="Date de notification">{c.notificationDate ? fmtDate(c.notificationDate) : "—"}</Info>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Étapes de la procédure</CardTitle></CardHeader><CardContent>
        {c.steps.length === 0 ? <p className="text-sm text-muted-foreground">Aucune étape enregistrée.</p> : (
          <ol className="divide-y text-sm">{c.steps.map((s) => <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2"><span><b>{STEP_KINDS.find((k) => k.value === s.kind)?.label}</b>{s.note ? ` — ${s.note}` : ""}</span><span className="text-xs text-muted-foreground">{fmtDate(s.date)}</span></li>)}</ol>
        )}
      </CardContent></Card>
      <EntityDocuments ctx={ctx} type="hr_sanction" id={c.id} />
      {!ctx.hasModule("documents") && <p className="text-xs text-muted-foreground">Activez le module Documents pour joindre les pièces (convocation, comptes rendus, décision).</p>}
      <Card><CardHeader><CardTitle className="text-base">Historique des actions</CardTitle></CardHeader><CardContent>
        <ul className="divide-y text-sm">{c.history.map((h) => <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2"><span>{h.summary}</span><span className="text-xs text-muted-foreground">{fmtDateTime(h.createdAt)}</span></li>)}</ul>
      </CardContent></Card>
    </div>
  );
}
