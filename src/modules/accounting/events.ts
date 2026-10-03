import "server-only";
import { on } from "@/core/events";
import {
  postCreditNote, postCustomerPayment, postExpense, postInvoice, postManualTransaction, postOpeningBalance, postPayrollPaid, postPayrollValidated, postSupplierBill, postSupplierPayment, postTransfer,
  reversePayroll, reverseCustomerPayment, reverseExpense, reverseInvoice, reverseManualTransaction, reverseSupplierBill, reverseSupplierPayment, reverseTransfer,
} from "./posting";

/**
 * Le module Comptabilité s'abonne aux événements des autres modules et génère les écritures (validées, immuables)
 * UNIQUEMENT si le module est actif pour l'entreprise. Exécuté dans la transaction de l'émetteur : si l'écriture est
 * impossible (période verrouillée, exercice clos, compte manquant), l'opération métier est annulée avec un message clair.
 * Ce module doit être enregistré APRÈS Finance (le compte de trésorerie du paiement est alors déjà fixé).
 */
const active = (ctx: { hasModule: (k: string) => boolean }) => ctx.hasModule("accounting");

on("invoice.issued", async (tx, ctx, { invoiceId }) => { if (active(ctx)) await postInvoice(tx, ctx, invoiceId); });
on("invoice.cancelled", async (tx, ctx, { invoiceId }) => { if (active(ctx)) await reverseInvoice(tx, ctx, invoiceId); });
on("credit_note.issued", async (tx, ctx, { creditNoteId }) => { if (active(ctx)) await postCreditNote(tx, ctx, creditNoteId); });
on("payment.validated", async (tx, ctx, { paymentId }) => { if (active(ctx)) await postCustomerPayment(tx, ctx, paymentId); });
on("payment.cancelled", async (tx, ctx, { paymentId }) => { if (active(ctx)) await reverseCustomerPayment(tx, ctx, paymentId); });
on("supplier_bill.posted", async (tx, ctx, { billId }) => { if (active(ctx)) await postSupplierBill(tx, ctx, billId); });
on("supplier_bill.cancelled", async (tx, ctx, { billId }) => { if (active(ctx)) await reverseSupplierBill(tx, ctx, billId); });
on("supplier_payment.validated", async (tx, ctx, { paymentId }) => { if (active(ctx)) await postSupplierPayment(tx, ctx, paymentId); });
on("supplier_payment.cancelled", async (tx, ctx, { paymentId }) => { if (active(ctx)) await reverseSupplierPayment(tx, ctx, paymentId); });
on("expense.paid", async (tx, ctx, { expenseId }) => { if (active(ctx)) await postExpense(tx, ctx, expenseId); });
on("expense.cancelled", async (tx, ctx, { expenseId }) => { if (active(ctx)) await reverseExpense(tx, ctx, expenseId); });
on("finance.manual_transaction.created", async (tx, ctx, { transactionId }) => { if (active(ctx)) await postManualTransaction(tx, ctx, transactionId); });
on("finance.manual_transaction.cancelled", async (tx, ctx, { transactionId }) => { if (active(ctx)) await reverseManualTransaction(tx, ctx, transactionId); });
on("finance.account.opening_balance", async (tx, ctx, { accountId }) => { if (active(ctx)) await postOpeningBalance(tx, ctx, accountId); });
on("payroll.validated", async (tx, ctx, { runId }) => { if (active(ctx)) await postPayrollValidated(tx, ctx, runId); });
on("payroll.paid", async (tx, ctx, { runId }) => { if (active(ctx)) await postPayrollPaid(tx, ctx, runId); });
on("payroll.cancelled", async (tx, ctx, { runId }) => { if (active(ctx)) await reversePayroll(tx, ctx, runId); });
on("finance.transfer.created", async (tx, ctx, { groupId }) => { if (active(ctx)) await postTransfer(tx, ctx, groupId); });
on("finance.transfer.cancelled", async (tx, ctx, { groupId }) => { if (active(ctx)) await reverseTransfer(tx, ctx, groupId); });
