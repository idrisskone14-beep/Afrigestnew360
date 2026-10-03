import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { decideApproval, listApprovals, pendingDecisionCount, savePolicy } from "@/core/approvals";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { setCompanyModule } from "@/modules/platform/companies";
import * as inv from "@/modules/inventory/service";
import { productSchema } from "@/modules/inventory/schemas";
import * as bills from "@/modules/purchasing/bills";
import * as proc from "@/modules/purchasing/procurement";
import * as sup from "@/modules/purchasing/suppliers";
import { purchaseOrderSchema, purchaseRequestSchema, supplierBillSchema, supplierSchema } from "@/modules/purchasing/schemas";
import { addMember, ctxFor, makeCompany } from "../helpers";

const today = () => new Date().toISOString().slice(0, 10);

async function setup() {
  const co = await makeCompany("ACHATS", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id); // administrateur (approbateur)
  const other = await addMember(co.company.id, "admin"); // 2ᵉ administrateur (demandeur)
  const requester = await ctxFor(other.user.id, co.company.id);
  const tax = await ctx.db.tax.findFirstOrThrow({ where: { isDefault: true } });
  const supplier = await sup.createSupplier(ctx, supplierSchema.parse({ name: "Cimenterie du Golfe", email: "ventes@cimgolfe.ci", paymentTermsDays: 30 }));
  const wh = (await inv.listWarehouses(ctx))[0]!;
  const product = await inv.createProduct(ctx, productSchema.parse({ name: "Ciment", type: "GOODS", unit: "sac", salePrice: 6500, costPrice: 5000, trackStock: true, minStock: 0, openingWarehouseId: wh.id, openingQuantity: 10 }));
  const line = (over = {}) => ({ productId: product.id, description: "Ciment 50 kg", unit: "sac", quantity: 100, unitPrice: 5200, discountPct: 0, taxId: tax.id, ...over });
  const stock = async () => Number((await ctx.db.stockLevel.aggregate({ where: { productId: product.id }, _sum: { quantity: true } }))._sum.quantity ?? 0);
  const cost = async () => Number((await inv.getProduct(ctx, product.id)).product.costPrice);
  return { ...co, ctx, requester, other, tax, supplier, wh, product, line, stock, cost };
}
type S = Awaited<ReturnType<typeof setup>>;

const newPO = async (s: S, lines = [s.line()]) => proc.createOrder(s.ctx, purchaseOrderSchema.parse({ supplierId: s.supplier.id, orderDate: today(), lines }));
const approvedPO = async (s: S, lines = [s.line()]) => { const o = await newPO(s, lines); await proc.submitOrder(s.ctx, o.id); return o; };
const receive = async (s: S, orderId: string, qty: number) => {
  const o = await proc.getOrder(s.ctx, orderId);
  const rc = await proc.createReceipt(s.ctx, { orderId, warehouseId: s.wh.id, receiptDate: today(), notes: "", lines: [{ orderLineId: o.lines[0]!.id, quantity: qty }] });
  await proc.confirmReceipt(s.ctx, rc.id);
  return rc;
};

describe("fournisseurs", () => {
  it("code automatique, recherche, archivage refusé avec une dette ouverte, isolation", async () => {
    const s = await setup();
    expect(s.supplier.code).toBe("FOU-00001");
    expect((await sup.listSuppliers(s.ctx, { q: "golfe", skip: 0, take: 10 })).rows.map((r) => r.id)).toEqual([s.supplier.id]);
    const o = await approvedPO(s);
    await receive(s, o.id, 100);
    const draft = await bills.createBillFromOrder(s.ctx, o.id);
    await bills.postBill(s.ctx, draft.id);
    await expect(sup.archiveSupplier(s.ctx, s.supplier.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const B = await setup();
    await expect(sup.getSupplier(B.ctx, s.supplier.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(sup.archiveSupplier(B.ctx, s.supplier.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(B.supplier.code).toBe("FOU-00001"); // compteur propre à chaque entreprise
  });
});

describe("demandes d'achat et approbations", () => {
  const req = (over = {}) => purchaseRequestSchema.parse({ reason: "Réapprovisionnement ciment", lines: [{ description: "Ciment 50 kg", unit: "sac", quantity: 100, estimatedPrice: 5200 }], ...over });

  it("sans règle d'approbation : approuvée automatiquement, puis transformée en commande", async () => {
    const s = await setup();
    const r = await proc.createRequest(s.requester, req());
    expect(r.number).toBe(`DA-${new Date().getFullYear()}-00001`);
    expect(Number(r.estimate)).toBe(520000);
    expect(await proc.submitRequest(s.requester, r.id)).toEqual({ needsApproval: false });
    expect((await proc.getRequest(s.ctx, r.id)).status).toBe("APPROVED");
    const order = await proc.convertRequestToOrder(s.ctx, { requestId: r.id, supplierId: s.supplier.id });
    expect(order.status).toBe("DRAFT");
    expect(Number(order.total)).toBe(613600); // 100 × 5200 + 18 %
    expect((await proc.getRequest(s.ctx, r.id)).status).toBe("ORDERED");
    await expect(proc.convertRequestToOrder(s.ctx, { requestId: r.id, supplierId: s.supplier.id })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("au-delà du seuil : validation d'un tiers habilité obligatoire (jamais le demandeur)", async () => {
    const s = await setup();
    await savePolicy(s.ctx, { type: "purchase_request", isEnabled: true, threshold: 100000 });
    const r = await proc.createRequest(s.requester, req());
    expect(await proc.submitRequest(s.requester, r.id)).toEqual({ needsApproval: true });
    expect((await proc.getRequest(s.ctx, r.id)).status).toBe("PENDING_APPROVAL");
    await expect(proc.convertRequestToOrder(s.ctx, { requestId: r.id, supplierId: s.supplier.id })).rejects.toMatchObject({ code: "BUSINESS_RULE" });

    const pending = (await listApprovals(s.ctx, { status: "PENDING", skip: 0, take: 10 })).rows;
    expect(pending).toHaveLength(1);
    expect(Number(pending[0]!.amount)).toBe(520000);
    // le demandeur ne se valide pas lui-même ; l'approbateur est notifié, pas le demandeur
    await expect(decideApproval(s.requester, { id: pending[0]!.id, decision: "APPROVED" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(await platformDb.notification.count({ where: { companyId: s.company.id, userId: s.owner.id, type: "approval.pending" } })).toBe(1);
    expect(await platformDb.notification.count({ where: { companyId: s.company.id, userId: s.other.user.id, type: "approval.pending" } })).toBe(0);
    expect(await pendingDecisionCount(s.ctx)).toBe(1);
    expect(await pendingDecisionCount(s.requester)).toBe(0);

    await decideApproval(s.ctx, { id: pending[0]!.id, decision: "APPROVED", comment: "OK" });
    expect((await proc.getRequest(s.ctx, r.id)).status).toBe("APPROVED");
    await expect(decideApproval(s.ctx, { id: pending[0]!.id, decision: "REJECTED", comment: "x" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(await platformDb.notification.count({ where: { companyId: s.company.id, userId: s.other.user.id, type: "approval.decided" } })).toBe(1);
  });

  it("refus : motif obligatoire, demande refusée ; sous le seuil pas d'approbation", async () => {
    const s = await setup();
    await savePolicy(s.ctx, { type: "purchase_request", isEnabled: true, threshold: 1_000_000 });
    const small = await proc.createRequest(s.requester, req());
    expect(await proc.submitRequest(s.requester, small.id)).toEqual({ needsApproval: false });
    const big = await proc.createRequest(s.requester, req({ lines: [{ description: "Gros achat", unit: "u", quantity: 1, estimatedPrice: 2_000_000 }] }));
    await proc.submitRequest(s.requester, big.id);
    const a = (await listApprovals(s.ctx, { status: "PENDING", skip: 0, take: 10 })).rows[0]!;
    await expect(decideApproval(s.ctx, { id: a.id, decision: "REJECTED" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await decideApproval(s.ctx, { id: a.id, decision: "REJECTED", comment: "Budget dépassé" });
    expect((await proc.getRequest(s.ctx, big.id)).status).toBe("REJECTED");
  });

  it("un membre sans le droit de valider est refusé ; approbation d'une autre entreprise introuvable", async () => {
    const s = await setup();
    await savePolicy(s.ctx, { type: "purchase_request", isEnabled: true, threshold: 1 });
    const r = await proc.createRequest(s.requester, req());
    await proc.submitRequest(s.requester, r.id);
    const a = (await listApprovals(s.ctx, { status: "PENDING", skip: 0, take: 10 })).rows[0]!;
    const emp = await addMember(s.company.id, "employee");
    await expect(decideApproval(await ctxFor(emp.user.id, s.company.id), { id: a.id, decision: "APPROVED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const B = await setup();
    await expect(decideApproval(B.ctx, { id: a.id, decision: "APPROVED" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listApprovals(B.ctx, { skip: 0, take: 10 })).total).toBe(0);
  });

  it("la règle est par entreprise : configurable, désactivable", async () => {
    const A = await setup();
    const B = await setup();
    await savePolicy(A.ctx, { type: "purchase_order", isEnabled: true, threshold: 500 });
    const oA = await newPO(A);
    const oB = await newPO(B);
    expect(await proc.submitOrder(A.ctx, oA.id)).toEqual({ needsApproval: true });
    expect(await proc.submitOrder(B.ctx, oB.id)).toEqual({ needsApproval: false });
    await expect(savePolicy(A.ctx, { type: "inconnu", isEnabled: true, threshold: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("commande → réception → facture → paiement", () => {
  it("commande soumise à approbation : validée par un tiers, refusée → retour au brouillon", async () => {
    const s = await setup();
    await savePolicy(s.ctx, { type: "purchase_order", isEnabled: true, threshold: 100000 });
    const o = await proc.createOrder(s.requester, purchaseOrderSchema.parse({ supplierId: s.supplier.id, orderDate: today(), lines: [s.line()] }));
    expect(await proc.submitOrder(s.requester, o.id)).toEqual({ needsApproval: true });
    expect((await proc.getOrder(s.ctx, o.id)).status).toBe("PENDING_APPROVAL");
    await expect(proc.createReceipt(s.ctx, { orderId: o.id, warehouseId: "", receiptDate: today(), notes: "", lines: [{ orderLineId: (await proc.getOrder(s.ctx, o.id)).lines[0]!.id, quantity: 1 }] })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    let a = (await listApprovals(s.ctx, { status: "PENDING", skip: 0, take: 10 })).rows[0]!;
    await decideApproval(s.ctx, { id: a.id, decision: "REJECTED", comment: "Négociez le prix" });
    expect((await proc.getOrder(s.ctx, o.id)).status).toBe("DRAFT");
    await proc.submitOrder(s.requester, o.id);
    a = (await listApprovals(s.ctx, { status: "PENDING", skip: 0, take: 10 })).rows[0]!;
    await decideApproval(s.ctx, { id: a.id, decision: "APPROVED" });
    expect((await proc.getOrder(s.ctx, o.id)).status).toBe("APPROVED");
  });

  it("parcours complet : réception partielle → stock valorisé → facture → paiements", async () => {
    const s = await setup();
    const o = await approvedPO(s, [s.line({ quantity: 100, unitPrice: 5200, discountPct: 0 })]);
    expect(o.number).toBe(`BC-${new Date().getFullYear()}-00001`);
    const stock0 = await s.stock();
    const cost0 = await s.cost();
    expect(cost0).toBe(5000);

    // réception partielle de 40
    const rc1 = await receive(s, o.id, 40);
    expect(rc1.number).toBe(`BR-${new Date().getFullYear()}-00001`);
    expect(await s.stock()).toBe(stock0 + 40);
    // coût moyen : (10 × 5000 + 40 × 5200) / 50 = 5160
    expect(await s.cost()).toBe(5160);
    expect((await proc.getOrder(s.ctx, o.id)).status).toBe("PARTIALLY_RECEIVED");
    const mv = await inv.listMovements(s.ctx, { productId: s.product.id, type: "IN", skip: 0, take: 5 });
    expect(mv.rows[0]).toMatchObject({ reference: rc1.number });

    // plus que le reliquat : refusé, brouillons inclus
    const ol = (await proc.getOrder(s.ctx, o.id)).lines[0]!;
    await expect(proc.createReceipt(s.ctx, { orderId: o.id, warehouseId: "", receiptDate: today(), notes: "", lines: [{ orderLineId: ol.id, quantity: 61 }] })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const draft = await proc.createReceipt(s.ctx, { orderId: o.id, warehouseId: s.wh.id, receiptDate: today(), notes: "", lines: [{ orderLineId: ol.id, quantity: 60 }] });
    await expect(proc.createReceipt(s.ctx, { orderId: o.id, warehouseId: "", receiptDate: today(), notes: "", lines: [{ orderLineId: ol.id, quantity: 1 }] })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await proc.confirmReceipt(s.ctx, draft.id);
    await expect(proc.confirmReceipt(s.ctx, draft.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect((await proc.getOrder(s.ctx, o.id)).status).toBe("RECEIVED");
    expect(await s.stock()).toBe(stock0 + 100);

    // facture fournisseur depuis la commande (quantités reçues)
    const b = await bills.createBillFromOrder(s.ctx, o.id);
    expect(Number(b.total)).toBe(613600);
    const posted = await bills.postBill(s.ctx, b.id);
    expect(posted.number).toBe(`FF-${new Date().getFullYear()}-00001`);
    expect((await proc.getOrder(s.ctx, o.id)).status).toBe("BILLED");
    await expect(bills.createBillFromOrder(s.ctx, o.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(bills.postBill(s.ctx, b.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect((await bills.payablesSummary(s.ctx)).outstanding.toNumber()).toBe(613600);

    // paiements
    const p1 = await bills.recordSupplierPayment(s.ctx, { billId: b.id, amount: 200000, method: "BANK_TRANSFER", date: today(), reference: "VIR-1" } as never);
    expect(p1.number).toBe(`PAI-${new Date().getFullYear()}-00001`);
    expect((await bills.getBill(s.ctx, b.id)).status).toBe("PARTIALLY_PAID");
    await expect(bills.recordSupplierPayment(s.ctx, { billId: b.id, amount: 500000, method: "CASH", date: today() } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await bills.recordSupplierPayment(s.ctx, { billId: b.id, amount: 413600, method: "CHEQUE", date: today() } as never);
    const paid = await bills.getBill(s.ctx, b.id);
    expect(paid.status).toBe("PAID");
    expect((await bills.payablesSummary(s.ctx)).outstanding.toNumber()).toBe(0);
    await bills.cancelSupplierPayment(s.ctx, p1.id);
    expect((await bills.getBill(s.ctx, b.id)).status).toBe("PARTIALLY_PAID");
    await expect(bills.cancelBill(s.ctx, b.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("CONCURRENCE : 6 paiements fournisseur simultanés de 40 % → jamais au-delà de la dette", async () => {
    const s = await setup();
    const o = await approvedPO(s);
    await receive(s, o.id, 100);
    const b = await bills.postBill(s.ctx, (await bills.createBillFromOrder(s.ctx, o.id)).id);
    const r = await Promise.allSettled(Array.from({ length: 6 }, () => bills.recordSupplierPayment(s.ctx, { billId: b.id, amount: 245440, method: "BANK_TRANSFER", date: today() } as never)));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(2);
    expect(Number((await bills.getBill(s.ctx, b.id)).amountPaid)).toBe(490880);
  });

  it("facture manuelle : doublon du n° fournisseur refusé ; annulation libère la commande", async () => {
    const s = await setup();
    const mk = (ref: string) => bills.createBill(s.ctx, supplierBillSchema.parse({ supplierId: s.supplier.id, supplierRef: ref, billDate: today(), lines: [{ description: "Transport", quantity: 1, unitPrice: 50000, taxId: s.tax.id }] }));
    const a = await bills.postBill(s.ctx, (await mk("FACT-778")).id);
    await expect(bills.postBill(s.ctx, (await mk("FACT-778")).id)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Doublon") });
    const o = await approvedPO(s);
    await receive(s, o.id, 100);
    const b = await bills.postBill(s.ctx, (await bills.createBillFromOrder(s.ctx, o.id)).id);
    await bills.cancelBill(s.ctx, b.id);
    expect((await proc.getOrder(s.ctx, o.id)).status).toBe("RECEIVED");
    expect(Number((await proc.getOrder(s.ctx, o.id)).lines[0]!.billedQty)).toBe(0);
    expect(a.status).toBe("POSTED");
  });

  it("sans le module Stock : la réception ne crée aucun mouvement", async () => {
    const s = await setup();
    await setCompanyModule(s.company.id, "inventory", false);
    const ctx = await ctxFor(s.owner.id, s.company.id);
    const o = await proc.createOrder(ctx, purchaseOrderSchema.parse({ supplierId: s.supplier.id, orderDate: today(), lines: [s.line()] }));
    await proc.submitOrder(ctx, o.id);
    const ol = (await proc.getOrder(ctx, o.id)).lines[0]!;
    const rc = await proc.createReceipt(ctx, { orderId: o.id, warehouseId: "", receiptDate: today(), notes: "", lines: [{ orderLineId: ol.id, quantity: 100 }] });
    await proc.confirmReceipt(ctx, rc.id);
    expect(await s.stock()).toBe(10);
    expect((await proc.getOrder(ctx, o.id)).status).toBe("RECEIVED");
  });

  it("annulation d'une commande refusée si réceptionnée ; brouillon supprimable", async () => {
    const s = await setup();
    const o = await approvedPO(s);
    await receive(s, o.id, 10);
    await expect(proc.cancelOrder(s.ctx, o.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const d2 = await newPO(s);
    await proc.deleteOrder(s.ctx, d2.id);
    const d3 = await approvedPO(s);
    await proc.cancelOrder(s.ctx, d3.id);
    expect((await proc.getOrder(s.ctx, d3.id)).status).toBe("CANCELLED");
  });
});

describe("ISOLATION des achats", () => {
  it("aucun accès, réception, paiement ou facturation sur les documents d'une autre entreprise", async () => {
    const A = await setup();
    const B = await setup();
    const oB = await approvedPO(B);
    const rcB = await receive(B, oB.id, 100);
    const bB = await bills.postBill(B.ctx, (await bills.createBillFromOrder(B.ctx, oB.id)).id);
    const olB = (await proc.getOrder(B.ctx, oB.id)).lines[0]!;

    await expect(proc.getOrder(A.ctx, oB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(proc.submitOrder(A.ctx, oB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(proc.getReceipt(A.ctx, rcB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(proc.createReceipt(A.ctx, { orderId: oB.id, warehouseId: "", receiptDate: today(), notes: "", lines: [{ orderLineId: olB.id, quantity: 1 }] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(bills.getBill(A.ctx, bB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(bills.recordSupplierPayment(A.ctx, { billId: bB.id, amount: 100, method: "CASH", date: today() } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(bills.createBillFromOrder(A.ctx, oB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(proc.createOrder(A.ctx, purchaseOrderSchema.parse({ supplierId: B.supplier.id, orderDate: today(), lines: [A.line()] }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(proc.createOrder(A.ctx, purchaseOrderSchema.parse({ supplierId: A.supplier.id, orderDate: today(), lines: [A.line({ productId: B.product.id })] }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await bills.listBills(A.ctx, { skip: 0, take: 50 })).total).toBe(0);
    expect((await proc.listOrders(A.ctx, { skip: 0, take: 50 })).total).toBe(0);
    expect((await bills.listSupplierPayments(A.ctx, { skip: 0, take: 50 })).total).toBe(0);
  });
});
