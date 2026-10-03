import "server-only";
import type { Db } from "@/core/db/client";
import type { TenantContext } from "@/core/tenant/context";

/**
 * Événements métier inter-modules, exécutés DANS la transaction de l'émetteur : si un abonné échoue
 * (stock insuffisant, période comptable close…), toute l'opération est annulée. Les modules ne s'importent
 * pas entre eux : Ventes émet, Stock/Finance/Comptabilité s'abonnent (et vérifient que leur module est actif).
 */
export interface DomainEvents {
  "order.confirmed": { orderId: string };
  "order.cancelled": { orderId: string };
  "delivery.confirmed": { deliveryId: string };
  "invoice.issued": { invoiceId: string };
  "invoice.cancelled": { invoiceId: string };
  "payment.validated": { paymentId: string };
  "payment.cancelled": { paymentId: string };
  "credit_note.issued": { creditNoteId: string };
  "goods_receipt.confirmed": { receiptId: string };
  "supplier_bill.posted": { billId: string };
  "supplier_bill.cancelled": { billId: string };
  "supplier_payment.validated": { paymentId: string };
  "supplier_payment.cancelled": { paymentId: string };
  "expense.paid": { expenseId: string };
  "expense.cancelled": { expenseId: string };
  "finance.manual_transaction.created": { transactionId: string };
  "finance.manual_transaction.cancelled": { transactionId: string };
  "finance.account.opening_balance": { accountId: string };
  "payroll.validated": { runId: string };
  "payroll.paid": { runId: string };
  "payroll.cancelled": { runId: string };
  "finance.transfer.created": { groupId: string };
  "finance.transfer.cancelled": { groupId: string };
  "approval.decided": { requestId: string; resourceType: string; resourceId: string; decision: "APPROVED" | "REJECTED" };
}

export type EventName = keyof DomainEvents;
export type EventHandler<K extends EventName> = (tx: Db, ctx: TenantContext, payload: DomainEvents[K]) => Promise<void>;

const handlers = new Map<EventName, EventHandler<never>[]>();

export function on<K extends EventName>(event: K, handler: EventHandler<K>) {
  const list = handlers.get(event) ?? [];
  list.push(handler as EventHandler<never>);
  handlers.set(event, list);
}

export async function emit<K extends EventName>(tx: Db, ctx: TenantContext, event: K, payload: DomainEvents[K]) {
  for (const h of handlers.get(event) ?? []) await (h as EventHandler<K>)(tx, ctx, payload);
}

/** Pour les tests : nombre d'abonnés d'un événement. */
export const subscribersOf = (event: EventName) => handlers.get(event)?.length ?? 0;
