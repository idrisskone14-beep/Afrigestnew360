import type { Metadata } from "next";
import Link from "next/link";
import { notFound, forbidden } from "next/navigation";
import { z } from "zod";
import { Trash2 } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { Info } from "@/components/app/info-item";
import { Status } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppError } from "@/core/errors";
import { d } from "@/core/money";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { EntityDocuments } from "@/modules/documents/ui/entity-documents";
import { createExpenseFromCostAction, deleteFineAction } from "@/modules/fleet/actions";
import { getFine } from "@/modules/fleet/fines";
import { fleetOptions } from "@/modules/fleet/lists";
import { FineDialog, FineStatusDialog } from "@/modules/fleet/ui/fleet-dialogs";

export const metadata: Metadata = { title: "Contravention" };

export default async function FineDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireModulePage("fleet");
  if (!ctx.can("fleet.fine.read")) forbidden();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const f = await getFine(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const manage = ctx.can("fleet.fine.manage");
  const opt = manage ? await fleetOptions(ctx) : null;
  const open = f.status === "TO_PAY" || f.status === "CONTESTED";
  const finance = manage && ctx.hasModule("finance") && ctx.can("finance.expense.create") && !f.expenseId && f.status !== "CANCELLED";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground"><Link href="/app/fleet/contraventions" className="hover:text-foreground">Contraventions</Link> / {f.number}</p>
          <h2 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">PV {f.number} <Status value={f.status} /></h2>
          <p className="text-sm text-muted-foreground">{f.offence}</p>
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            {open && opt && <FineDialog fine={{ ...f, amount: d(f.amount).toNumber() }} vehicles={opt.allVehicles} drivers={opt.drivers} />}
            {(f.status === "TO_PAY" || f.status === "CONTESTED") && <FineStatusDialog id={f.id} current={f.status} />}
            {finance && <ActionButton action={createExpenseFromCostAction} input={{ source: "fine" as const, id: f.id }} variant="outline" size="sm" label="Créer la dépense" success="Dépense créée (brouillon)" />}
            {f.status !== "PAID" && !f.expenseId && <ActionButton action={deleteFineAction} input={{ id: f.id }} variant="outline" size="sm" label="Supprimer" icon={<Trash2 className="size-4" />} redirectTo="/app/fleet/contraventions" success="Contravention supprimée" confirm={{ title: `Supprimer le PV ${f.number} ?`, confirmLabel: "Supprimer" }} />}
          </div>
        )}
      </div>
      <Card><CardHeader><CardTitle className="text-base">Détail</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3">
        <Info label="Date et heure">{fmtDate(f.date)}{f.time ? ` à ${f.time}` : ""}</Info><Info label="Lieu">{f.place ?? "—"}</Info><Info label="Montant">{formatMoney(d(f.amount).toNumber(), ctx.company.currency)}</Info>
        <Info label="Véhicule"><Link href={`/app/fleet/vehicules/${f.vehicle.id}`} className="hover:text-brand">{f.vehicle.plate}</Link></Info><Info label="Chauffeur">{f.driver?.fullName ?? "Non identifié"}</Info>
        <Info label="Échéance de paiement">{f.dueDate ? fmtDate(f.dueDate) : "—"}</Info>
        {f.paidAt && <Info label="Payée le">{fmtDate(f.paidAt)}</Info>}
        {f.contestReason && <div className="sm:col-span-3"><Info label="Motif de contestation / d'annulation">{f.contestReason}</Info></div>}
        {f.notes && <div className="sm:col-span-3"><Info label="Notes">{f.notes}</Info></div>}
        {f.expenseId && <p className="text-xs text-muted-foreground sm:col-span-3">Une dépense a été créée dans Finance pour ce PV.</p>}
      </CardContent></Card>
      <EntityDocuments ctx={ctx} type="fine" id={f.id} />
      {!ctx.hasModule("documents") && <p className="text-xs text-muted-foreground">Activez le module Documents pour joindre le PV ou une photo à cette contravention.</p>}
    </div>
  );
}
