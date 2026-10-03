import type { Metadata } from "next";
import { EntityDocuments } from "@/modules/documents/ui/entity-documents";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Ban, Send, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { Status } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canDecide } from "@/core/approvals";
import { AppError } from "@/core/errors";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate, fmtDateTime, toInputDate } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { cancelExpenseAction, deleteExpenseAction, submitExpenseAction } from "@/modules/finance/actions";
import { getExpense } from "@/modules/finance/expenses";
import { listAccounts, listCategories } from "@/modules/finance/treasury";
import { ExpenseFormDialog, PayExpenseDialog } from "@/modules/finance/ui/expense-dialogs";
import { DecisionButtons } from "@/modules/purchasing/ui/purchase-dialogs";
import { DocHeader } from "@/modules/sales/ui/doc-kit";

export const metadata: Metadata = { title: "Dépense" };
const METHOD: Record<string, string> = { CASH: "Espèces", BANK_TRANSFER: "Virement", CHEQUE: "Chèque", MOBILE_MONEY: "Mobile money", CARD: "Carte", OTHER: "Autre" };

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePagePermission("finance.expense.read");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const e = await getExpense(ctx, id).catch((x) => { if (x instanceof AppError && x.code === "NOT_FOUND") notFound(); throw x; });
  const mine = e.createdById === ctx.user.id;
  const manager = ctx.access.isAdmin || ctx.can("finance.expense.approve");
  const canEdit = (mine || manager) && ctx.can("finance.expense.update");
  const [approvals, accounts, categories, suppliers, author, branches, costCenters, projects] = await Promise.all([
    ctx.db.approvalRequest.findMany({ where: { resourceType: "expense", resourceId: id }, orderBy: { createdAt: "desc" } }),
    e.status === "APPROVED" && ctx.can("finance.account.read") ? listAccounts(ctx) : Promise.resolve([]),
    (e.status === "DRAFT" || e.status === "REJECTED") && canEdit ? listCategories(ctx, { kind: "EXPENSE" }) : Promise.resolve([]),
    (e.status === "DRAFT" || e.status === "REJECTED") && canEdit && ctx.hasModule("purchases") && ctx.can("purchases.supplier.read") ? ctx.db.supplier.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    ctx.db.companyMembership.findFirst({ where: { userId: e.createdById }, select: { user: { select: { name: true } } } }),
    ctx.db.branch.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ctx.db.costCenter.findMany({ where: { deletedAt: null }, select: { id: true, name: true, code: true }, orderBy: { code: "asc" } }),
    ctx.hasModule("projects") && ctx.can("project.project.read") ? ctx.db.project.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const pending = approvals.find((a) => a.status === "PENDING");
  const editable = e.status === "DRAFT" || e.status === "REJECTED";

  return (
    <div className="space-y-6">
      <DocHeader
        crumbs={[{ label: "Dépenses", href: "/app/finance/depenses" }, { label: e.number }]}
        title={`Dépense ${e.number}`}
        badges={<Status value={e.status === "APPROVED" ? "EXPENSE_APPROVED" : e.status} />}
        subtitle={<>{e.description} · saisie par {author?.user.name ?? "—"} le {fmtDate(e.date)}</>}
        actions={canEdit && editable ? <ExpenseFormDialog categories={categories.map((c) => ({ id: c.id, name: c.name }))} suppliers={suppliers} branches={branches} projects={projects.map((p) => ({ id: p.id, name: `${p.code} — ${p.name}` }))} costCenters={costCenters.map((c) => ({ id: c.id, name: `${c.code} — ${c.name}` }))} expense={{ id: e.id, date: toInputDate(e.date), categoryId: e.categoryId, supplierId: e.supplierId ?? "", description: e.description, amount: num(e.amount), method: e.method, reference: e.reference ?? "", notes: e.notes ?? "", branchId: e.branchId ?? "", costCenterId: e.costCenterId ?? "", projectId: e.projectId ?? "" }} /> : undefined}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          {editable && (mine || manager) && ctx.can("finance.expense.create") && <ActionButton action={submitExpenseAction} input={{ id: e.id }} variant="default" label="Soumettre" icon={<Send className="size-4" />} success="Dépense soumise" confirm={{ title: "Soumettre la dépense ?", description: "Selon les règles de l'entreprise, elle est approuvée automatiquement ou envoyée à un approbateur.", confirmLabel: "Soumettre" }} />}
          {pending && !mine && canDecide(ctx, "expense") && <DecisionButtons id={pending.id} title={`Dépense ${e.number}`} />}
          {pending && mine && <p className="text-sm text-muted-foreground">En attente de validation par un approbateur (vous ne pouvez pas valider votre propre dépense).</p>}
          {e.status === "APPROVED" && ctx.can("finance.expense.update") && ctx.can("finance.account.read") && <PayExpenseDialog expenseId={e.id} amount={num(e.amount)} currency={e.currency} method={e.method} accounts={accounts.map((a) => ({ id: a.id, name: a.name, balance: a.balance.toNumber(), type: a.type }))} />}
          {e.status !== "CANCELLED" && (mine || manager) && ctx.can("finance.expense.update") && <ActionButton action={cancelExpenseAction} input={{ id: e.id }} variant="outline" label="Annuler" icon={<Ban className="size-4" />} success="Dépense annulée" confirm={{ title: "Annuler la dépense ?", description: e.status === "PAID" ? "La sortie de trésorerie est annulée et le solde du compte est rétabli." : undefined, confirmLabel: "Annuler la dépense" }} />}
          {e.status === "DRAFT" && (mine || manager) && ctx.can("finance.expense.delete") && <ActionButton action={deleteExpenseAction} input={{ id: e.id }} variant="destructive" label="Supprimer" icon={<Trash2 className="size-4" />} redirectTo="/app/finance/depenses" success="Dépense supprimée" confirm={{ title: "Supprimer cette dépense ?" }} />}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Info label="Montant"><span className="text-lg font-semibold tabular">{formatMoney(num(e.amount), e.currency)}</span></Info>
          <Info label="Catégorie">{e.category.name}</Info>
          <Info label="Fournisseur">{e.supplier ? <Link href={`/app/purchases/fournisseurs/${e.supplier.id}`} className="hover:text-brand">{e.supplier.name}</Link> : "—"}</Info>
          <Info label="Mode">{METHOD[e.method]}</Info>
          <Info label="N° de pièce">{e.reference ?? "—"}</Info>
          <Info label="Compte débité">{e.account?.name ?? "—"}</Info>
          <Info label="Payée le">{fmtDate(e.paidAt)}</Info>
          {e.projectId && <Info label="Projet"><Link href={`/app/projects/projets/${e.projectId}`} className="hover:text-brand">{projects.find((p) => p.id === e.projectId)?.name ?? "Voir le projet"}</Link></Info>}
          <Info label="Agence">{branches.find((b) => b.id === e.branchId)?.name ?? "—"}</Info>
          <Info label="Centre de coûts">{(() => { const c = costCenters.find((x) => x.id === e.costCenterId); return c ? `${c.code} — ${c.name}` : "—"; })()}</Info>
        </CardContent>
      </Card>
      {e.notes && <Card><CardContent className="p-4 text-sm"><p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Notes</p>{e.notes}</CardContent></Card>}

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
      <EntityDocuments ctx={ctx} type="expense" id={id} />
    </div>
  );
}

const Info = ({ label, children }: { label: string; children: React.ReactNode }) => <div><p className="text-xs text-muted-foreground">{label}</p><p className="text-sm font-medium">{children}</p></div>;
