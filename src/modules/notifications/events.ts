import "server-only";
import { on } from "@/core/events";
import { usersWithPermission, notify } from "@/core/notifications";
import { formatMoney } from "@/lib/reference-data";

/** Notifie les responsables des encaissements lorsqu'un paiement client est validé (hors l'auteur de l'action). */
on("payment.validated", async (tx, ctx, { paymentId }) => {
  if (!ctx.hasModule("sales")) return;
  const p = await tx.payment.findFirstOrThrow({ where: { id: paymentId } });
  const [customer, invoice] = await Promise.all([
    p.customerId ? tx.customer.findFirst({ where: { id: p.customerId }, select: { name: true } }) : null,
    p.invoiceId ? tx.invoice.findFirst({ where: { id: p.invoiceId }, select: { id: true, number: true } }) : null,
  ]);
  const audience = await usersWithPermission(tx, "finance.payment.read", ctx.user.id);
  await notify(tx, {
    companyId: ctx.company.id, userIds: audience, type: "payment.received",
    title: `Paiement reçu : ${formatMoney(Number(p.amount), p.currency)}`,
    body: [customer?.name, invoice?.number ? `facture ${invoice.number}` : null, p.number].filter(Boolean).join(" · "),
    link: invoice ? `/app/sales/factures/${invoice.id}` : "/app/sales/paiements",
  });
});
