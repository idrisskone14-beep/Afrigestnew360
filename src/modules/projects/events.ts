import "server-only";
import { on } from "@/core/events";

/** Une facture annulée libère le temps qu'elle facturait : il redevient facturable. */
on("invoice.cancelled", async (tx, _ctx, { invoiceId }) => {
  await tx.timeEntry.updateMany({ where: { invoiceId }, data: { invoiceId: null } });
});
