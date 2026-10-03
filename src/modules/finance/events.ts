import "server-only";
import { on } from "@/core/events";
import { cancelTransactionsOf, recordTransaction, resolveAccount } from "./treasury";

/**
 * Abonnements du module Finance (actifs seulement si le module Finance l'est pour l'entreprise) :
 *  - payment.validated / supplier_payment.validated : mouvement de trésorerie sur le compte choisi (ou le compte par défaut du mode de paiement) ;
 *  - payment.cancelled / supplier_payment.cancelled : annulation du mouvement ;
 *  - approval.decided : applique la décision aux dépenses.
 * Si aucun compte n'existe, aucun mouvement n'est créé : la trésorerie n'est pas encore configurée.
 */
const active = (ctx: { hasModule: (k: string) => boolean }) => ctx.hasModule("finance");

on("payment.validated", async (tx, ctx, { paymentId }) => {
  if (!active(ctx)) return;
  const p = await tx.payment.findFirstOrThrow({ where: { id: paymentId } });
  const account = await resolveAccount(tx, { accountId: p.accountId, method: p.method });
  if (!account) return;
  await recordTransaction(tx, ctx, { accountId: account.id, type: "IN", date: p.date, amount: p.amount, description: `Encaissement ${p.number}`, reference: p.reference, sourceType: "payment", sourceId: p.id });
  if (!p.accountId) await tx.payment.update({ where: { id: p.id }, data: { accountId: account.id } });
});

on("payment.cancelled", async (tx, ctx, { paymentId }) => {
  if (!active(ctx)) return;
  await cancelTransactionsOf(tx, "payment", paymentId);
});

on("supplier_payment.validated", async (tx, ctx, { paymentId }) => {
  if (!active(ctx)) return;
  const p = await tx.payment.findFirstOrThrow({ where: { id: paymentId } });
  const account = await resolveAccount(tx, { accountId: p.accountId, method: p.method });
  if (!account) return;
  await recordTransaction(tx, ctx, { accountId: account.id, type: "OUT", date: p.date, amount: p.amount, description: `Règlement fournisseur ${p.number}`, reference: p.reference, sourceType: "supplier_payment", sourceId: p.id });
  if (!p.accountId) await tx.payment.update({ where: { id: p.id }, data: { accountId: account.id } });
});

on("supplier_payment.cancelled", async (tx, ctx, { paymentId }) => {
  if (!active(ctx)) return;
  await cancelTransactionsOf(tx, "supplier_payment", paymentId);
});

// Paie : les salaires nets sortent de la trésorerie, sur le compte choisi, au paiement de la campagne
on("payroll.paid", async (tx, ctx, { runId }) => {
  if (!active(ctx)) return;
  const run = await tx.payrollRun.findFirstOrThrow({ where: { id: runId } });
  if (!run.accountId) return;
  const cat = await tx.financeCategory.findFirst({ where: { name: "Salaires et charges sociales", kind: "EXPENSE" }, select: { id: true } });
  await recordTransaction(tx, ctx, { accountId: run.accountId, type: "OUT", date: run.paidAt ?? new Date(), amount: run.totalNet, description: `Paie ${String(run.month).padStart(2, "0")}/${run.year}`, categoryId: cat?.id, sourceType: "payroll", sourceId: run.id });
});

on("approval.decided", async (tx, _ctx, { resourceType, resourceId, decision }) => {
  if (resourceType !== "expense") return;
  const e = await tx.expense.findFirst({ where: { id: resourceId } });
  if (e?.status === "PENDING_APPROVAL") await tx.expense.update({ where: { id: resourceId }, data: { status: decision === "APPROVED" ? "APPROVED" : "REJECTED" } });
});
