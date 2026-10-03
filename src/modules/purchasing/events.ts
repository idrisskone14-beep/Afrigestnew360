import "server-only";
import { on } from "@/core/events";

/**
 * Abonnements du module Achats.
 *  - approval.decided : applique la décision finale d'un circuit de validation aux demandes d'achat, commandes et règlements fournisseurs.
 */
on("approval.decided", async (tx, ctx, { resourceType, resourceId, decision }) => {
  if (resourceType === "supplier_payment") {
    // décision finale : le règlement est appliqué (dette réduite, trésorerie, comptabilité) ou abandonné ; import différé (évite un cycle avec bills.ts)
    const p = await tx.payment.findFirst({ where: { id: resourceId, direction: "OUT" } });
    if (p?.status !== "PENDING") return;
    if (decision === "APPROVED") await (await import("./bills")).applySupplierPayment(tx, ctx, resourceId);
    else await tx.payment.update({ where: { id: resourceId }, data: { status: "CANCELLED" } });
  } else if (resourceType === "purchase_request") {
    const r = await tx.purchaseRequest.findFirst({ where: { id: resourceId } });
    if (r?.status === "PENDING_APPROVAL") await tx.purchaseRequest.update({ where: { id: resourceId }, data: { status: decision === "APPROVED" ? "APPROVED" : "REJECTED" } });
  } else if (resourceType === "purchase_order") {
    const o = await tx.purchaseOrder.findFirst({ where: { id: resourceId } });
    // refus : retour au brouillon pour correction et nouvelle soumission
    if (o?.status === "PENDING_APPROVAL") await tx.purchaseOrder.update({ where: { id: resourceId }, data: { status: decision === "APPROVED" ? "APPROVED" : "DRAFT" } });
  }
});
