import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { z } from "zod";
import { AlertTriangle, Archive, ArchiveRestore, CheckCircle2, FileDown, RotateCcw } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { Info } from "@/components/app/info-item";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppError } from "@/core/errors";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { EntityDocuments } from "@/modules/documents/ui/entity-documents";
import { getAccident, logAccidentView } from "@/modules/hr/accidents";
import { archiveAccidentAction, closeAccidentAction, reopenAccidentAction } from "@/modules/hr/registers-actions";
import { ACCIDENT_KINDS, ACCIDENT_STATUSES, CNPS_STATUSES, QUALIFICATIONS } from "@/modules/hr/registers-schemas";
import { AccidentDialog } from "@/modules/hr/ui/register-dialogs";

export const metadata: Metadata = { title: "Dossier d'accident" };
const label = (list: readonly { value: string; label: string }[], v: string) => list.find((x) => x.value === v)?.label ?? v;
const Text = ({ children }: { children: string | null }) => <span className="whitespace-pre-line">{children || "—"}</span>;

export default async function AccidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireModulePage("hr");
  if (!ctx.can("hr.accident.read")) forbidden();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const a = await getAccident(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  await logAccidentView(ctx, a); // consultation d'un dossier sensible : tracée
  const manage = ctx.can("hr.accident.manage");
  const blocking = a.gaps.filter((g) => g.blocking), advice = a.gaps.filter((g) => !g.blocking);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground"><Link href="/app/hr/accidents" className="hover:text-foreground">Accidents de travail</Link> / {a.number}</p>
          <h2 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">{a.number} <StatusBadge tone={a.status === "OPEN" ? "info" : a.status === "CLOSED" ? "success" : "neutral"}>{label(ACCIDENT_STATUSES, a.status)}</StatusBadge></h2>
          <p className="text-sm text-muted-foreground">{label(ACCIDENT_KINDS, a.kind)} · {a.employeeName} ({a.employeeNumber})</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><a href={`/api/pdf/hr_accident/${a.id}`} target="_blank" rel="noreferrer"><FileDown className="size-4" /> Fiche PDF</a></Button>
          {manage && a.status === "OPEN" && <>
            <AccidentDialog accident={a} />
            <ActionButton action={closeAccidentAction} input={{ id: a.id }} size="sm" variant="outline" label="Clôturer" icon={<CheckCircle2 className="size-4" />} success="Dossier clos" confirm={{ title: "Clôturer ce dossier ?", description: "Un dossier clos n'est plus modifiable tant qu'il n'est pas rouvert." }} />
          </>}
          {manage && a.status === "CLOSED" && <>
            <ActionButton action={reopenAccidentAction} input={{ id: a.id }} size="sm" variant="outline" label="Rouvrir" icon={<RotateCcw className="size-4" />} success="Dossier rouvert" />
            <ActionButton action={archiveAccidentAction} input={{ id: a.id, archived: true }} size="sm" variant="outline" label="Archiver" icon={<Archive className="size-4" />} success="Dossier archivé" confirm={{ title: "Archiver ce dossier ?", description: "Le dossier reste conservé et consultable ; il est masqué de la liste par défaut." }} />
          </>}
          {manage && a.status === "ARCHIVED" && <ActionButton action={archiveAccidentAction} input={{ id: a.id, archived: false }} size="sm" variant="outline" label="Désarchiver" icon={<ArchiveRestore className="size-4" />} success="Dossier désarchivé" />}
        </div>
      </div>

      {(blocking.length > 0 || advice.length > 0) && a.status !== "ARCHIVED" && (
        <Card className="border-amber-300/60 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/5">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4 text-amber-600" /> Dossier à compléter</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {blocking.map((g) => <p key={g.code}>• {g.message}</p>)}
            {advice.map((g) => <p key={g.code} className="text-muted-foreground">• {g.message}</p>)}
            {a.documentCount === 0 && <p className="text-muted-foreground">• Aucune pièce justificative jointe</p>}
            {blocking.length > 0 && <p className="pt-1 text-xs text-muted-foreground">Les points en première partie bloquent la clôture du dossier.</p>}
          </CardContent>
        </Card>
      )}

      <Card><CardHeader><CardTitle className="text-base">Les faits</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3">
        <Info label="Date et heure">{fmtDate(a.occurredOn)}{a.occurredTime ? ` à ${a.occurredTime}` : ""}</Info>
        <Info label="Lieu">{a.place}</Info>
        <Info label="Type d'accident">{a.category ?? "—"}</Info>
        <div className="sm:col-span-3"><Info label="Circonstances"><Text>{a.circumstances}</Text></Info></div>
        {a.kind === "COMMUTE" && <div className="sm:col-span-3"><Info label="Trajet (itinéraire, interruptions éventuelles)"><Text>{a.commuteDetails}</Text></Info></div>}
        <Info label="Service">{a.departmentName ?? "—"}</Info>
        <div className="sm:col-span-3"><Info label="Nature des blessures"><Text>{a.injuries}</Text></Info></div>
        <Info label="Témoins"><Text>{a.witnesses}</Text></Info>
        <Info label="Premiers soins"><Text>{a.firstAid}</Text></Info>
        <Info label="Établissement de prise en charge">{a.careFacility ?? "—"}</Info>
      </CardContent></Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">Arrêt de travail</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
          <Info label="Arrêt prescrit">{a.workStop ? "Oui" : "Non"}</Info>
          <Info label="Date de reprise">{a.returnDate ? fmtDate(a.returnDate) : "—"}</Info>
          {a.workStop && <><Info label="Début">{a.stopStart ? fmtDate(a.stopStart) : "—"}</Info><Info label="Fin">{a.stopEnd ? fmtDate(a.stopEnd) : "—"}</Info></>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Déclaration CNPS</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
          <Info label="Statut">{label(CNPS_STATUSES, a.cnpsStatus)}</Info>
          <Info label="Date de déclaration">{a.cnpsDeclaredOn ? fmtDate(a.cnpsDeclaredOn) : "—"}</Info>
          <Info label="Référence">{a.cnpsReference ?? "—"}</Info>
          <Info label="Qualification">{label(QUALIFICATIONS, a.qualification)}</Info>
          <p className="text-xs text-muted-foreground sm:col-span-2">Les délais et formalités de déclaration sont ceux fixés par la réglementation applicable : confirmez-les avec votre conseil. Ce registre numérique ne remplace pas les registres légaux.</p>
        </CardContent></Card>
      </div>

      <Card><CardHeader><CardTitle className="text-base">Mesures correctives</CardTitle></CardHeader><CardContent className="text-sm"><Text>{a.correctiveActions}</Text></CardContent></Card>

      <EntityDocuments ctx={ctx} type="hr_accident" id={a.id} />
      {!ctx.hasModule("documents") && <p className="text-xs text-muted-foreground">Activez le module Documents pour joindre les pièces justificatives (certificat médical, déclaration, photos).</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">Historique des actions</CardTitle></CardHeader>
        <CardContent>
          {a.history.length === 0 ? <p className="text-sm text-muted-foreground">Aucune action enregistrée.</p> : (
            <ul className="divide-y text-sm">{a.history.map((h) => <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2"><span>{h.summary}</span><span className="text-xs text-muted-foreground">{fmtDateTime(h.createdAt)}</span></li>)}</ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
