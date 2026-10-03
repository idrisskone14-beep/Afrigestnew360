import type { Metadata } from "next";
import { requirePagePermission } from "@/core/tenant/guards";
import { todayInput } from "@/lib/format";
import { listJournals, listLedgerAccounts } from "@/modules/accounting/service";
import { EntryEditor } from "@/modules/accounting/ui/entry-editor";

export const metadata: Metadata = { title: "Nouvelle écriture" };

export default async function NewEntryPage() {
  const ctx = await requirePagePermission("accounting.entry.create");
  const [journals, accounts] = await Promise.all([listJournals(ctx), listLedgerAccounts(ctx)]);
  const usable = journals.filter((j) => j.type !== "OPENING");
  return <EntryEditor currency={ctx.company.currency} journals={usable} accounts={accounts.map((a) => ({ id: a.id, code: a.code, name: a.name }))} initial={{ journalId: usable.find((j) => j.type === "MISC")?.id ?? usable[0]?.id ?? "", date: todayInput(), reference: "", description: "", lines: [] }} />;
}
