import type { Metadata } from "next";
import Link from "next/link";
import { PauseCircle, PlayCircle, Repeat, Trash2, Zap } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { EmptyState } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate, toInputDate } from "@/lib/format";
import { deleteRecurringAction, runRecurringNowAction, setRecurringStatusAction } from "@/modules/sales/actions";
import { FREQUENCY_LABEL, listRecurring } from "@/modules/sales/recurring";
import { EditRecurringDialog } from "@/modules/sales/ui/recurring-dialogs";

export const metadata: Metadata = { title: "Factures récurrentes" };

const STATUS_VIEW = { ACTIVE: { label: "Actif", tone: "success" }, PAUSED: { label: "En pause", tone: "warning" }, ENDED: { label: "Terminé", tone: "neutral" } } as const;

export default async function RecurringInvoicesPage() {
  const ctx = await requirePagePermission("finance.invoice.read");
  const rows = await listRecurring(ctx);
  const canCreate = ctx.can("finance.invoice.create");
  const canUpdate = ctx.can("finance.invoice.update");

  return (
    <>
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">Un modèle génère une facture identique à chaque échéance (abonnement, loyer, maintenance), en brouillon ou émise et envoyée automatiquement. Pour en créer un, ouvrez une facture et choisissez « Rendre récurrente ».</p>
      {rows.length === 0 ? (
        <EmptyState icon={<Repeat className="size-8" />} title="Aucune facture récurrente" description="Ouvrez une facture (émise ou brouillon) puis « Rendre récurrente » : ses lignes servent de modèle." />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Modèle</TableHead><TableHead>Client</TableHead><TableHead className="hidden md:table-cell">Fréquence</TableHead><TableHead>Prochaine facture</TableHead><TableHead className="hidden lg:table-cell">Automatique</TableHead><TableHead className="hidden sm:table-cell text-right">Générées</TableHead><TableHead>État</TableHead><TableHead className="w-48"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => {
                const view = STATUS_VIEW[r.status];
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-normal text-sm font-medium">{r.title}{r.lastError && <span className="mt-0.5 block text-xs font-normal text-destructive">{r.lastError}</span>}</TableCell>
                    <TableCell className="text-sm"><Link href={`/app/crm/clients/${r.customer.id}`} className="hover:text-brand">{r.customer.name}</Link></TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{FREQUENCY_LABEL[r.frequency]}</TableCell>
                    <TableCell className="text-sm">{r.status === "ENDED" ? "—" : fmtDate(r.nextRunDate)}{r.endDate && <span className="block text-xs text-muted-foreground">jusqu&apos;au {fmtDate(r.endDate)}</span>}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{r.autoIssue ? (r.autoSend ? "Émise et envoyée" : "Émise") : "Brouillon"}</TableCell>
                    <TableCell className="hidden text-right text-sm tabular sm:table-cell">{r._count.invoices}</TableCell>
                    <TableCell><StatusBadge tone={view.tone}>{view.label}</StatusBadge></TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-0.5">
                        {canCreate && r.status !== "ENDED" && <ActionButton action={runRecurringNowAction} input={{ id: r.id }} variant="ghost" size="icon" label="" ariaLabel="Générer la facture maintenant" icon={<Zap className="size-4" />} success="Facture générée" redirectToNew="/app/sales/factures" confirm={{ title: "Générer la facture maintenant ?", description: "Une facture datée d'aujourd'hui est créée à partir du modèle, et la prochaine échéance avance d'une période.", confirmLabel: "Générer" }} />}
                        {canUpdate && r.status === "ACTIVE" && <ActionButton action={setRecurringStatusAction} input={{ id: r.id, status: "PAUSED" as const }} variant="ghost" size="icon" label="" ariaLabel="Mettre en pause" icon={<PauseCircle className="size-4" />} success="Modèle mis en pause" />}
                        {canUpdate && r.status === "PAUSED" && <ActionButton action={setRecurringStatusAction} input={{ id: r.id, status: "ACTIVE" as const }} variant="ghost" size="icon" label="" ariaLabel="Réactiver" icon={<PlayCircle className="size-4" />} success="Modèle réactivé" />}
                        {canUpdate && r.status !== "ENDED" && <EditRecurringDialog id={r.id} initial={{ title: r.title, frequency: r.frequency, nextRunDate: toInputDate(r.nextRunDate), endDate: toInputDate(r.endDate), autoIssue: r.autoIssue, autoSend: r.autoSend }} />}
                        {ctx.can("finance.invoice.delete") && <ActionButton action={deleteRecurringAction} input={{ id: r.id }} variant="ghost" size="icon" label="" ariaLabel="Supprimer le modèle" icon={<Trash2 className="size-4 text-destructive" />} success="Modèle supprimé" confirm={{ title: "Supprimer ce modèle ?", description: "Les factures déjà générées sont conservées ; aucune nouvelle ne sera créée." }} />}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
