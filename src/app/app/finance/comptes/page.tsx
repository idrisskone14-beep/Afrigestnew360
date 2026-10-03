import type { Metadata } from "next";
import Link from "next/link";
import { Landmark } from "lucide-react";
import { EmptyState } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { formatMoney } from "@/lib/reference-data";
import { AccountFormDialog, TransactionDialog, TransferDialog } from "@/modules/finance/ui/treasury-dialogs";
import { listAccounts, listCategories } from "@/modules/finance/treasury";

export const metadata: Metadata = { title: "Comptes" };
const TYPE_LABEL = { BANK: "Banque", CASH: "Caisse", MOBILE_MONEY: "Mobile money" } as const;

export default async function AccountsPage() {
  const ctx = await requirePagePermission("finance.account.read");
  const [accounts, categories] = await Promise.all([listAccounts(ctx, { includeInactive: true }), listCategories(ctx)]);
  const active = accounts.filter((a) => a.isActive);
  const manage = ctx.can("finance.account.manage");
  const counts = manage ? new Set((await ctx.db.financialTransaction.groupBy({ by: ["accountId"], _count: true })).map((g) => g.accountId)) : new Set<string>();
  const cur = ctx.company.currency;
  const total = active.reduce((a, b) => a + b.balance.toNumber(), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">Trésorerie totale : <span className="font-semibold text-foreground tabular">{formatMoney(total, cur)}</span></p>
        {ctx.can("finance.transfer.create") && <TransferDialog accounts={active.map((a) => ({ id: a.id, name: a.name }))} />}
        {manage && active.length > 0 && <TransactionDialog accounts={active.map((a) => ({ id: a.id, name: a.name }))} categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))} />}
        {manage && <AccountFormDialog />}
      </div>
      {accounts.length === 0 ? <EmptyState icon={<Landmark className="size-8" />} title="Aucun compte" description="Créez un compte bancaire, une caisse ou un compte de mobile money." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Compte</TableHead><TableHead className="hidden sm:table-cell">Type</TableHead><TableHead className="hidden md:table-cell">Banque / n°</TableHead><TableHead className="text-right">Solde</TableHead><TableHead>Statut</TableHead>{manage && <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>}</TableRow></TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell><Link href={`/app/finance/mouvements?compte=${a.id}`} className="text-sm font-medium hover:text-brand">{a.name}</Link>{a.isDefault && <span className="ml-2 text-xs text-muted-foreground">par défaut</span>}</TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{TYPE_LABEL[a.type]}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{[a.bankName, a.accountNumber].filter(Boolean).join(" · ") || "—"}</TableCell>
                  <TableCell className={`text-right text-sm tabular ${a.balance.lt(0) ? "text-destructive" : ""}`}>{formatMoney(a.balance.toNumber(), cur)}</TableCell>
                  <TableCell><StatusBadge tone={a.isActive ? "success" : "neutral"}>{a.isActive ? "Actif" : "Inactif"}</StatusBadge></TableCell>
                  {manage && <TableCell><AccountFormDialog account={{ id: a.id, name: a.name, type: a.type, bankName: a.bankName ?? "", accountNumber: a.accountNumber ?? "", openingBalance: num(a.openingBalance), isDefault: a.isDefault, isActive: a.isActive, hasMovements: counts.has(a.id) }} /></TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
