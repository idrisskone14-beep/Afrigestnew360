import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CheckCircle2, Pencil, Trash2, Undo2 } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { Status } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { d, num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { deleteEntryAction, reverseEntryAction, validateEntryAction } from "@/modules/accounting/actions";
import { DocHeader } from "@/modules/sales/ui/doc-kit";

export const metadata: Metadata = { title: "Écriture comptable" };
const SOURCE: Record<string, string> = { invoice: "Facture client", credit_note: "Avoir", payment: "Encaissement", supplier_bill: "Facture fournisseur", supplier_payment: "Règlement fournisseur", expense: "Dépense", manual_transaction: "Mouvement de trésorerie", transfer: "Transfert", year_close: "Clôture d'exercice", year_open: "À-nouveaux", "manual:reversal": "Contre-passation" };

export default async function EntryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("accounting.entry.read");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const e = await ctx.db.journalEntry.findFirst({ where: { id }, include: { journal: true, fiscalYear: true, lines: { orderBy: { position: "asc" }, include: { ledgerAccount: { select: { id: true, code: true, name: true } } } } } });
  if (!e) notFound();
  const cur = ctx.company.currency;
  const debit = e.lines.reduce((a, l) => a.plus(l.debit), d(0));
  const credit = e.lines.reduce((a, l) => a.plus(l.credit), d(0));
  const manual = !e.sourceType;
  const reversal = e.sourceType?.endsWith("reversal") || Boolean(e.reversalOfId);
  const reversedBy = e.status === "POSTED" ? await ctx.db.journalEntry.findFirst({ where: { reversalOfId: e.id }, select: { id: true, number: true } }) : null;
  const original = e.reversalOfId ? await ctx.db.journalEntry.findFirst({ where: { id: e.reversalOfId }, select: { id: true, number: true } }) : null;

  return (
    <div className="space-y-6">
      <DocHeader
        crumbs={[{ label: "Écritures", href: "/app/accounting/ecritures" }, { label: e.status === "DRAFT" ? "Brouillon" : e.number }]}
        title={e.status === "DRAFT" ? "Écriture (brouillon)" : `Écriture ${e.number}`}
        badges={<Status value={e.status} />}
        subtitle={<>{e.journal.code} — {e.journal.name} · {fmtDate(e.date)} · exercice {e.fiscalYear.name}{e.reference ? ` · pièce ${e.reference}` : ""}{e.sourceType ? ` · ${SOURCE[e.sourceType] ?? e.sourceType}` : ""}</>}
        actions={manual && e.status === "DRAFT" && ctx.can("accounting.entry.create") ? <Button variant="outline" asChild><Link href={`/app/accounting/ecritures/${e.id}/modifier`}><Pencil className="size-4" /> Modifier</Link></Button> : undefined}
      />
      <p className="text-sm">{e.description}</p>

      {(manual && e.status === "DRAFT") || (manual && e.status === "POSTED" && !reversal && !reversedBy) ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            {e.status === "DRAFT" && ctx.can("accounting.entry.validate") && <ActionButton action={validateEntryAction} input={{ id: e.id }} variant="default" label="Valider l'écriture" icon={<CheckCircle2 className="size-4" />} success="Écriture validée" confirm={{ title: "Valider l'écriture ?", description: "Elle reçoit son numéro définitif et devient immuable : une erreur se corrige ensuite par contre-passation.", confirmLabel: "Valider" }} />}
            {e.status === "DRAFT" && ctx.can("accounting.entry.create") && <ActionButton action={deleteEntryAction} input={{ id: e.id }} variant="destructive" label="Supprimer le brouillon" icon={<Trash2 className="size-4" />} redirectTo="/app/accounting/ecritures" success="Brouillon supprimé" confirm={{ title: "Supprimer ce brouillon ?" }} />}
            {e.status === "POSTED" && ctx.can("accounting.entry.validate") && <ActionButton action={reverseEntryAction} input={{ id: e.id }} label="Contre-passer" icon={<Undo2 className="size-4" />} success="Écriture contre-passée" redirectToNew="/app/accounting/ecritures" confirm={{ title: "Contre-passer cette écriture ?", description: "Une écriture inverse est créée à la date du jour ; l'originale reste inchangée.", confirmLabel: "Contre-passer" }} />}
          </CardContent>
        </Card>
      ) : null}
      {reversedBy && <p className="text-sm text-muted-foreground">Contre-passée par <Link href={`/app/accounting/ecritures/${reversedBy.id}`} className="text-brand hover:underline">{reversedBy.number}</Link>.</p>}
      {original && <p className="text-sm text-muted-foreground">Contre-passation de <Link href={`/app/accounting/ecritures/${original.id}`} className="text-brand hover:underline">{original.number}</Link>.</p>}

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Compte</TableHead><TableHead>Libellé</TableHead><TableHead className="text-right">Débit</TableHead><TableHead className="text-right">Crédit</TableHead></TableRow></TableHeader>
          <TableBody>
            {e.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="whitespace-nowrap text-sm"><Link href={`/app/accounting/grand-livre?compte=${l.ledgerAccount.id}&exercice=${e.fiscalYearId}`} className="hover:text-brand"><span className="font-medium">{l.ledgerAccount.code}</span> <span className="text-muted-foreground">{l.ledgerAccount.name}</span></Link></TableCell>
                <TableCell className="max-w-xs whitespace-normal text-sm text-muted-foreground">{l.label}</TableCell>
                <TableCell className="text-right text-sm tabular">{num(l.debit) ? formatMoney(num(l.debit), cur) : ""}</TableCell>
                <TableCell className="text-right text-sm tabular">{num(l.credit) ? formatMoney(num(l.credit), cur) : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter><TableRow><TableCell colSpan={2} className="text-sm font-semibold">Total</TableCell><TableCell className="text-right text-sm font-semibold tabular">{formatMoney(debit.toNumber(), cur)}</TableCell><TableCell className="text-right text-sm font-semibold tabular">{formatMoney(credit.toNumber(), cur)}</TableCell></TableRow></TableFooter>
        </Table>
      </Card>
      {e.postedAt && <p className="text-xs text-muted-foreground">Validée le {fmtDateTime(e.postedAt)}.</p>}
    </div>
  );
}
