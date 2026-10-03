import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { EmptyState } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { daysLate, invoiceBalance, overdueInvoices } from "@/modules/sales/invoices";
import { ReminderDialog } from "@/modules/sales/ui/invoice-dialogs";

export const metadata: Metadata = { title: "Relances" };

export default async function RemindersPage() {
  const ctx = await requirePagePermission("finance.invoice.read");
  const rows = await overdueInvoices(ctx);
  const canRemind = ctx.can("finance.invoice.update");
  const total = rows.reduce((a, i) => a + invoiceBalance(i).toNumber(), 0);

  return (
    <>
      {rows.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="size-8 text-success" />} title="Aucune facture en retard" description="Toutes vos factures échues sont réglées. Les impayés apparaîtront ici avec leur historique de relances." />
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">{rows.length} facture{rows.length > 1 ? "s" : ""} échue{rows.length > 1 ? "s" : ""} pour un total de <strong className="text-foreground">{formatMoney(total, ctx.company.currency)}</strong>.</p>
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Facture</TableHead><TableHead>Client</TableHead><TableHead>Échéance</TableHead><TableHead className="text-right">Reste dû</TableHead><TableHead className="hidden md:table-cell">Dernière relance</TableHead><TableHead className="w-28"><span className="sr-only">Action</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((i) => {
                  const days = daysLate(i.dueDate);
                  return (
                    <TableRow key={i.id}>
                      <TableCell><Link href={`/app/sales/factures/${i.id}`} className="text-sm font-medium hover:text-brand">{i.number}</Link></TableCell>
                      <TableCell className="text-sm"><Link href={`/app/crm/clients/${i.customer.id}`} className="hover:text-brand">{i.customer.name}</Link></TableCell>
                      <TableCell className="text-sm"><span className="font-medium text-destructive">{fmtDate(i.dueDate)}</span><span className="block text-xs text-muted-foreground">{days} jour{days > 1 ? "s" : ""} de retard</span></TableCell>
                      <TableCell className="text-right text-sm font-medium tabular">{formatMoney(invoiceBalance(i).toNumber(), i.currency)}</TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{i.reminders[0] ? `n°${i.reminders[0].level} le ${fmtDate(i.reminders[0].sentAt)}` : "Jamais"}</TableCell>
                      <TableCell>{canRemind && <ReminderDialog invoiceId={i.id} hasEmail={Boolean(i.customer.email)} nextLevel={i._count.reminders + 1} />}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}
