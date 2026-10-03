import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Ban, Pencil, Send, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { Status } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canDecide } from "@/core/approvals";
import { AppError } from "@/core/errors";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { cancelRequestAction, deleteRequestAction, submitRequestAction } from "@/modules/purchasing/actions";
import { getRequest } from "@/modules/purchasing/procurement";
import { ConvertRequestDialog, DecisionButtons } from "@/modules/purchasing/ui/purchase-dialogs";
import { DocHeader, TotalsView } from "@/modules/sales/ui/doc-kit";

export const metadata: Metadata = { title: "Demande d'achat" };

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("purchases.request.read");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const r = await getRequest(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const cur = r.currency;
  const mine = r.requesterId === ctx.user.id;
  const canManage = (mine || ctx.access.isAdmin || ctx.can("purchases.request.approve")) && ctx.can("purchases.request.create");
  const [approvals, suppliers, requester] = await Promise.all([
    ctx.db.approvalRequest.findMany({ where: { resourceType: "purchase_request", resourceId: id }, orderBy: { createdAt: "desc" } }),
    r.status === "APPROVED" && ctx.can("purchases.order.create") ? ctx.db.supplier.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    ctx.db.companyMembership.findFirst({ where: { userId: r.requesterId }, select: { user: { select: { name: true } } } }),
  ]);
  const pending = approvals.find((a) => a.status === "PENDING");

  return (
    <div className="space-y-6">
      <DocHeader
        crumbs={[{ label: "Demandes d'achat", href: "/app/purchases/demandes" }, { label: r.number }]}
        title={`Demande ${r.number}`}
        badges={<Status value={r.status} />}
        subtitle={<>Par {requester?.user.name ?? "—"} · besoin pour le {fmtDate(r.neededBy)}{r.orderId ? <> · <Link href={`/app/purchases/commandes/${r.orderId}`} className="text-brand hover:underline">commande liée</Link></> : null}</>}
        actions={canManage && r.status === "DRAFT" ? <Button variant="outline" asChild><Link href={`/app/purchases/demandes/${r.id}/modifier`}><Pencil className="size-4" /> Modifier</Link></Button> : undefined}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          {canManage && r.status === "DRAFT" && <ActionButton action={submitRequestAction} input={{ id: r.id }} variant="default" label="Soumettre" icon={<Send className="size-4" />} success="Demande soumise" confirm={{ title: "Soumettre la demande ?", description: "Selon les règles de l'entreprise, elle sera validée automatiquement ou envoyée à un approbateur.", confirmLabel: "Soumettre" }} />}
          {pending && canDecide(ctx, "purchase_request") && !mine && <DecisionButtons id={pending.id} title={`Demande d'achat ${r.number}`} />}
          {r.status === "APPROVED" && ctx.can("purchases.order.create") && <ConvertRequestDialog requestId={r.id} suppliers={suppliers} />}
          {canManage && ["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(r.status) && <ActionButton action={cancelRequestAction} input={{ id: r.id }} variant="outline" label="Annuler" icon={<Ban className="size-4" />} success="Demande annulée" confirm={{ title: "Annuler la demande ?", confirmLabel: "Annuler la demande" }} />}
          {canManage && r.status === "DRAFT" && <ActionButton action={deleteRequestAction} input={{ id: r.id }} variant="destructive" label="Supprimer" icon={<Trash2 className="size-4" />} redirectTo="/app/purchases/demandes" success="Demande supprimée" confirm={{ title: "Supprimer cette demande ?" }} />}
          {r.status === "PENDING_APPROVAL" && mine && <p className="text-sm text-muted-foreground">En attente de validation par un approbateur (vous ne pouvez pas valider votre propre demande).</p>}
        </CardContent>
      </Card>

      {r.reason && <Card><CardContent className="p-4 text-sm"><p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Motif</p>{r.reason}</CardContent></Card>}

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Désignation</TableHead><TableHead className="text-right">Qté</TableHead><TableHead className="hidden text-right sm:table-cell">Prix estimé</TableHead><TableHead className="text-right">Montant</TableHead></TableRow></TableHeader>
          <TableBody>
            {r.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="max-w-xs whitespace-normal text-sm">{l.description}</TableCell>
                <TableCell className="text-right text-sm tabular">{num(l.quantity)} {l.unit}</TableCell>
                <TableCell className="hidden text-right text-sm tabular sm:table-cell">{formatMoney(num(l.estimatedPrice), cur)}</TableCell>
                <TableCell className="text-right text-sm font-medium tabular">{formatMoney(num(l.quantity) * num(l.estimatedPrice), cur)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <TotalsView currency={cur} rows={[{ label: "Estimation totale", value: num(r.estimate), bold: true }]} />

      {approvals.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Historique de validation</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {approvals.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-6 py-3 text-sm">
                <div className="min-w-0 flex-1"><p className="font-medium">{a.status === "PENDING" ? "En attente" : a.status === "APPROVED" ? "Validée" : a.status === "REJECTED" ? "Refusée" : "Annulée"}</p>{a.comment && <p className="text-xs text-muted-foreground">{a.comment}</p>}</div>
                <span className="text-xs text-muted-foreground">{fmtDateTime(a.decidedAt ?? a.createdAt)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
