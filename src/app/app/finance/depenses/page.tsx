import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Status, StatusBadge } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, enumParam, param, parseListParams, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { listExpenses } from "@/modules/finance/expenses";
import { listCategories } from "@/modules/finance/treasury";
import { ExpenseFormDialog } from "@/modules/finance/ui/expense-dialogs";

export const metadata: Metadata = { title: "Dépenses" };
const STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "PAID", "CANCELLED"] as const;

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("finance.expense.read");
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", STATUSES);
  const categories = await listCategories(ctx, { kind: "EXPENSE", includeInactive: true });
  const categoryId = categories.find((c) => c.id === param(sp, "categorie"))?.id;
  const mine = enumParam(sp, "auteur", ["moi"] as const) === "moi";
  const { rows, total, sum } = await listExpenses(ctx, { q: lp.q, status, categoryId, mine, skip: lp.skip, take: lp.take });
  const suppliers = ctx.hasModule("purchases") && ctx.can("purchases.supplier.read") ? await ctx.db.supplier.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const [branches, costCenters] = ctx.can("finance.expense.create") ? await Promise.all([ctx.db.branch.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }), ctx.db.costCenter.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true, code: true }, orderBy: { code: "asc" } })]) : [[], []];
  const projects = ctx.can("finance.expense.create") && ctx.hasModule("projects") && ctx.can("project.project.read") ? await ctx.db.project.findMany({ where: { deletedAt: null, status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] } }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }) : [];
  const cur = ctx.company.currency;

  return (
    <>
      <ListToolbar placeholder="N°, libellé ou pièce…" filters={[
        { name: "statut", label: "Statut", options: [{ value: "DRAFT", label: "Brouillons" }, { value: "PENDING_APPROVAL", label: "À valider" }, { value: "APPROVED", label: "À payer" }, { value: "REJECTED", label: "Refusées" }, { value: "PAID", label: "Payées" }, { value: "CANCELLED", label: "Annulées" }] },
        { name: "categorie", label: "Catégorie", options: categories.map((c) => ({ value: c.id, label: c.name })) },
        { name: "auteur", label: "Auteur", options: [{ value: "moi", label: "Mes dépenses" }] },
      ]}>
        {ctx.can("finance.expense.create") && <ExpenseFormDialog categories={categories.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name }))} suppliers={suppliers} branches={branches} projects={projects.map((p) => ({ id: p.id, name: `${p.code} — ${p.name}` }))} costCenters={costCenters.map((c) => ({ id: c.id, name: `${c.code} — ${c.name}` }))} />}
      </ListToolbar>
      {rows.length === 0 ? <EmptyState icon={<Receipt className="size-8" />} title="Aucune dépense" description="Saisissez une dépense : elle suit le circuit brouillon → validation éventuelle → paiement depuis un compte." /> : (
        <>
          <p className="mb-2 text-sm text-muted-foreground">{total} dépense{total > 1 ? "s" : ""} · total <span className="font-medium text-foreground tabular">{formatMoney(sum.toNumber(), cur)}</span></p>
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader><TableRow><TableHead>N°</TableHead><TableHead>Libellé</TableHead><TableHead className="hidden md:table-cell">Catégorie</TableHead><TableHead className="hidden sm:table-cell">Date</TableHead><TableHead className="text-right">Montant</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell><Link href={`/app/finance/depenses/${e.id}`} className="text-sm font-medium hover:text-brand">{e.number}</Link></TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-sm">{e.description}{e.supplier && <span className="block text-xs text-muted-foreground">{e.supplier.name}</span>}</TableCell>
                    <TableCell className="hidden text-sm md:table-cell"><StatusBadge>{e.category.name}</StatusBadge></TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{fmtDate(e.date)}</TableCell>
                    <TableCell className="text-right text-sm tabular">{formatMoney(num(e.amount), e.currency)}</TableCell>
                    <TableCell><Status value={e.status === "APPROVED" ? "EXPENSE_APPROVED" : e.status === "PAID" ? "PAID" : e.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/finance/depenses" searchParams={sp} />
    </>
  );
}
