import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { toInputDate } from "@/lib/format";
import { listJournals, listLedgerAccounts } from "@/modules/accounting/service";
import { EntryEditor } from "@/modules/accounting/ui/entry-editor";

export const metadata: Metadata = { title: "Modifier le brouillon" };

export default async function EditEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("accounting.entry.create");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const e = await ctx.db.journalEntry.findFirst({ where: { id }, include: { lines: { orderBy: { position: "asc" } } } });
  if (!e) notFound();
  if (e.status !== "DRAFT" || e.sourceType) redirect(`/app/accounting/ecritures/${id}`);
  const [journals, accounts] = await Promise.all([listJournals(ctx), listLedgerAccounts(ctx)]);
  return (
    <EntryEditor
      id={id} currency={ctx.company.currency} journals={journals.filter((j) => j.type !== "OPENING")} accounts={accounts.map((a) => ({ id: a.id, code: a.code, name: a.name }))}
      initial={{ journalId: e.journalId, date: toInputDate(e.date), reference: e.reference ?? "", description: e.description, lines: e.lines.map((l) => ({ ledgerAccountId: l.ledgerAccountId, label: l.label, debit: num(l.debit), credit: num(l.credit) })) }}
    />
  );
}
