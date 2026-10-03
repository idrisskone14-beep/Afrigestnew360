/**
 * Données métier de démonstration pour « AFRICA BUSINESS DEMO SARL » (distribution de matériaux, Abidjan).
 * Créées via les SERVICES de l'application (numérotation, stock, soldes, écritures) : les chiffres sont
 * donc cohérents entre CRM, ventes, stock, finance et comptabilité. Idempotent (ne fait rien si déjà peuplé).
 */
import { platformDb } from "@/core/db/client";
import { savePolicy } from "@/core/approvals";
import { buildAccess } from "@/core/rbac/access";
import { createTenantContext } from "@/core/tenant/ctx-factory";
import * as crm from "@/modules/crm/service";
import * as inventory from "@/modules/inventory/service";
import * as invoices from "@/modules/sales/invoices";
import * as orders from "@/modules/sales/orders";
import * as payments from "@/modules/sales/payments";
import * as quotes from "@/modules/sales/quotes";
import * as ex from "@/modules/finance/expenses";
import * as rp from "@/modules/finance/reports";
import * as tr from "@/modules/finance/treasury";
import * as accRep from "@/modules/accounting/reports";
import * as acc from "@/modules/accounting/service";
import * as bills from "@/modules/purchasing/bills";
import * as proc from "@/modules/purchasing/procurement";
import * as sup from "@/modules/purchasing/suppliers";
import { customerSchema, leadSchema } from "@/modules/crm/schemas";
import { productSchema } from "@/modules/inventory/schemas";
import { budgetSchema, expenseSchema, manualTransactionSchema } from "@/modules/finance/schemas";
import { purchaseOrderSchema, purchaseRequestSchema, supplierSchema } from "@/modules/purchasing/schemas";
import { invoiceSchema, orderSchema, quoteSchema } from "@/modules/sales/schemas";

const DAY = 86_400_000;
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);
const pick = <T>(arr: readonly T[], i: number) => arr[i % arr.length]!;

/** Valeur du stock (quantités × coût moyen). */
async function stockValue(ctx: Awaited<ReturnType<typeof loadContext>>) {
  const levels = await ctx.db.stockLevel.findMany({ include: { product: { select: { costPrice: true } } } });
  return Math.round(levels.reduce((a, l) => a + Number(l.quantity) * Number(l.product.costPrice), 0));
}

export async function loadContext(companyId: string, userId: string) {
  const m = await platformDb.companyMembership.findUniqueOrThrow({ where: { userId_companyId: { userId, companyId } }, include: { company: true, role: true, user: true } });
  const mods = await platformDb.companyModule.findMany({ where: { companyId, enabled: true }, select: { module: { select: { key: true } } } });
  return createTenantContext({
    user: { id: m.user.id, name: m.user.name, email: m.user.email, isPlatformAdmin: false, locale: "fr", twoFactorEnabled: false, emailVerified: true },
    sessionId: "seed",
    company: { id: m.company.id, legalName: m.company.legalName, tradeName: m.company.tradeName, slug: m.company.slug, currency: m.company.currency, timezone: m.company.timezone, country: m.company.country, logoUrl: null },
    membership: { id: m.id, roleId: m.roleId, roleName: m.role.name, isOwner: m.isOwner },
    access: buildAccess({ isAdmin: true, grantedKeys: [], enabledModules: mods.map((x) => x.module.key) }),
    switcher: [],
  });
}

const CUSTOMERS = [
  ["Quincaillerie Koffi & Fils", "Abidjan", "Cocody"], ["BTP Ivoire Construction SARL", "Abidjan", "Marcory"], ["Établissements Traoré", "Bouaké", "Commerce"],
  ["SOGEBAT", "Abidjan", "Yopougon"], ["Pharmacie du Plateau", "Abidjan", "Plateau"], ["Hôtel Ivoire Palace", "Abidjan", "Cocody"], ["Coopérative Agricole du Nord", "Korhogo", "Centre"],
  ["Mairie de Yamoussoukro", "Yamoussoukro", "Centre"], ["École Les Palmiers", "San-Pédro", "Quartier Sud"], ["Groupe Diabaté Immobilier", "Abidjan", "Riviera"],
  ["Menuiserie Kouassi", "Daloa", "Zone industrielle"], ["Station Total Bingerville", "Bingerville", "Route de Dabou"],
] as const;

const PRODUCTS = [
  ["Ciment CPJ 42,5 — sac 50 kg", "Matériaux", "sac", 6500, 5100, 400], ["Fer à béton Ø10 — barre 12 m", "Matériaux", "barre", 7200, 5800, 600], ["Fer à béton Ø12 — barre 12 m", "Matériaux", "barre", 10400, 8500, 450],
  ["Brique creuse 15 cm", "Matériaux", "unité", 350, 240, 3000], ["Sable de lagune — m³", "Matériaux", "m³", 9000, 6500, 120], ["Gravier 5/15 — m³", "Matériaux", "m³", 14000, 10500, 90],
  ["Peinture vinylique blanche 20 L", "Peinture", "seau", 38000, 29500, 60], ["Peinture glycéro 5 L", "Peinture", "pot", 17500, 13200, 45], ["Enduit de façade 25 kg", "Peinture", "sac", 12500, 9400, 80],
  ["Tôle ondulée 3 m", "Toiture", "feuille", 6800, 5200, 250], ["Tôle bac alu 4 m", "Toiture", "feuille", 11500, 8900, 140], ["Pointes 80 mm — carton 25 kg", "Quincaillerie", "carton", 21000, 16800, 35],
  ["Cadenas haute sécurité", "Quincaillerie", "unité", 4500, 3100, 90], ["Serrure à mortaiser", "Quincaillerie", "unité", 8500, 6200, 55], ["Charnière 100 mm (lot de 2)", "Quincaillerie", "lot", 1800, 1100, 200],
  ["Perceuse à percussion 800 W", "Outillage", "unité", 48000, 36500, 18], ["Meuleuse 125 mm", "Outillage", "unité", 39000, 29800, 12], ["Brouette renforcée", "Outillage", "unité", 28500, 21000, 25],
  ["Tuyau PVC Ø100 — barre 4 m", "Plomberie", "barre", 9800, 7400, 110], ["Robinet mélangeur chromé", "Plomberie", "unité", 15500, 11200, 40],
] as const;

export async function seedBusinessDemo(companyId: string, userId: string) {
  const ctx = await loadContext(companyId, userId);
  if ((await ctx.db.customer.count()) > 0) return { skipped: true };
  const log = (m: string) => console.log(`  • ${m}`);

  // ── Soldes d'ouverture de la trésorerie (avant tout mouvement)
  for (const a of await tr.listAccounts(ctx)) {
    await tr.updateAccount(ctx, { id: a.id, name: a.name, type: a.type, bankName: a.bankName ?? "", accountNumber: a.accountNumber ?? "", openingBalance: a.type === "BANK" ? 18_500_000 : 2_000_000, isDefault: a.isDefault, isActive: true });
  }

  // Ventilation comptable des soldes d'ouverture (471 → capital social), par une écriture d'opérations diverses validée
  {
    const od = (await acc.listJournals(ctx)).find((j) => j.code === "OD")!;
    const ledger = await acc.listLedgerAccounts(ctx);
    const total = (await tr.listAccounts(ctx)).reduce((a, b) => a + b.balance.toNumber(), 0);
    const entry = await acc.createManualEntry(ctx, { journalId: od.id, date: dateStr(0), description: "Ventilation des soldes d'ouverture : capital social", reference: "AG constitutive", lines: [
      { ledgerAccountId: ledger.find((a) => a.code === "471")!.id, label: "Solde d'ouverture à ventiler", debit: total, credit: 0 },
      { ledgerAccountId: ledger.find((a) => a.code === "101")!.id, label: "Capital social", debit: 0, credit: total },
    ] } as never);
    await acc.validateManualEntry(ctx, entry.id);
  }

  // ── Entrepôts, catégories, produits ─────────────────────────
  const main = (await inventory.listWarehouses(ctx))[0]!;
  const bouake = await inventory.createWarehouse(ctx, { name: "Dépôt Bouaké", code: "BKE", address: "Zone commerciale, Bouaké", isDefault: false });
  const cats = new Map<string, string>();
  for (const name of ["Matériaux", "Peinture", "Toiture", "Quincaillerie", "Outillage", "Plomberie"]) cats.set(name, (await inventory.createCategory(ctx, { name })).id);
  const tax = (await ctx.db.tax.findFirstOrThrow({ where: { isDefault: true } }));
  const products: Awaited<ReturnType<typeof inventory.createProduct>>[] = [];
  for (const [name, cat, unit, price, cost, qty] of PRODUCTS) {
    const low = name.includes("Meuleuse") || name.includes("Pointes");
    products.push(await inventory.createProduct(ctx, productSchema.parse({
      name, type: "GOODS", categoryId: cats.get(cat), unit, salePrice: price, costPrice: cost, taxId: tax.id, trackStock: true, minStock: Math.round(qty * 0.2),
      openingWarehouseId: main.id, openingQuantity: low ? Math.round(qty * 0.15) : qty,
    })));
  }
  // Stock d'ouverture : constaté au bilan d'ouverture (311 / capital social)
  const stockAtStart = await stockValue(ctx);
  {
    const od = (await acc.listJournals(ctx)).find((j) => j.code === "OD")!;
    const ledger = await acc.listLedgerAccounts(ctx);
    const e = await acc.createManualEntry(ctx, { journalId: od.id, date: `${new Date().getUTCFullYear()}-01-01`, description: "Bilan d'ouverture : stock de marchandises", reference: "Inventaire initial", lines: [
      { ledgerAccountId: ledger.find((a) => a.code === "311")!.id, label: "Stock d'ouverture", debit: stockAtStart, credit: 0 },
      { ledgerAccountId: ledger.find((a) => a.code === "101")!.id, label: "Capital social", debit: 0, credit: stockAtStart },
    ] } as never);
    await acc.validateManualEntry(ctx, e.id);
  }
  await inventory.createProduct(ctx, productSchema.parse({ name: "Livraison sur chantier (Abidjan)", type: "SERVICE", unit: "forfait", salePrice: 25000, costPrice: 0, taxId: tax.id, trackStock: false, minStock: 0 }));
  const transport = (await ctx.db.product.findFirstOrThrow({ where: { type: "SERVICE" } }));
  await inventory.manualMovement(ctx, { kind: "TRANSFER", productId: products[0]!.id, warehouseId: main.id, toWarehouseId: bouake.id, quantity: 60, reason: "Approvisionnement du dépôt de Bouaké" } as never);
  log(`${products.length + 1} produits, 2 entrepôts`);

  // ── CRM ─────────────────────────────────────────────────────
  const customers: Awaited<ReturnType<typeof crm.createCustomer>>[] = [];
  for (const [i, [name, city]] of CUSTOMERS.entries()) {
    const c = await crm.createCustomer(ctx, customerSchema.parse({
      type: "COMPANY", name, city, country: "CI", email: `contact@${name.toLowerCase().replace(/[^a-z]+/g, "").slice(0, 14)}.ci`, phone: `+225 07 ${String(10 + i * 7).padStart(2, "0")} ${String(20 + i * 3).padStart(2, "0")} ${String(40 + i).padStart(2, "0")} 11`,
      paymentTermsDays: i % 4 === 0 ? 45 : 30, creditLimit: i === 1 ? 4_000_000 : "",
    }));
    await crm.addContact(ctx, { customerId: c.id, name: pick(["Awa Koné", "Yao N'Guessan", "Mariam Sylla", "Kouadio Brou", "Fatou Camara", "Ibrahim Ouattara"], i), title: "Responsable achats", email: c.email ?? "", phone: c.phone ?? "", isPrimary: true });
    customers.push(c);
  }
  const stages = await crm.listStages(ctx);
  const open = stages.filter((s) => s.kind === "OPEN");
  const leadSeed = [["Adama Bamba", "Bamba Matériaux", 3_500_000], ["Kader Soro", "Soro & Frères BTP", 8_200_000], ["Estelle Gnahoré", "Résidence Les Orchidées", 12_000_000], ["Moussa Konaté", "Konaté Plomberie", 950_000], ["Pascal Akpa", "Chantier Akpa", 2_100_000], ["Salimata Dosso", "Dosso Décoration", 1_400_000]] as const;
  for (const [name, companyName, estimatedValue] of leadSeed) await crm.createLead(ctx, leadSchema.parse({ name, companyName, estimatedValue, source: pick(["Recommandation", "Salon BTP", "Site web", "Appel entrant"], name.length), email: `${name.split(" ")[0]!.toLowerCase()}@mail.ci` }));
  const leads = await ctx.db.lead.findMany({ take: 2 });
  await crm.updateLead(ctx, { ...leadSchema.parse({ name: leads[0]!.name, companyName: leads[0]!.companyName ?? "", estimatedValue: 3_500_000 }), id: leads[0]!.id, status: "QUALIFIED" });
  for (const [i, c] of customers.slice(0, 8).entries()) {
    const stage = pick(open, i);
    const opp = await crm.createOpportunity(ctx, { title: `${pick(["Marché de fournitures", "Chantier résidentiel", "Rénovation", "Commande annuelle"], i)} — ${c.name}`, customerId: c.id, stageId: stage.id, amount: (1 + (i % 5)) * 1_800_000, expectedCloseDate: dateStr(-15 - i * 4), notes: "" } as never);
    if (i === 6) await crm.moveOpportunity(ctx, { id: opp.id, stageId: stages.find((s) => s.kind === "WON")!.id });
    if (i === 7) await crm.moveOpportunity(ctx, { id: opp.id, stageId: stages.find((s) => s.kind === "LOST")!.id, lostReason: "Concurrent moins cher" });
  }
  for (const [i, c] of customers.slice(0, 5).entries()) {
    await crm.createActivity(ctx, { type: "TASK", subject: pick(["Relancer le devis", "Appeler pour la livraison", "Envoyer le catalogue 2026", "Planifier une visite de chantier", "Confirmer l'acompte"], i), dueAt: new Date(Date.now() + (i - 2) * DAY).toISOString(), customerId: c.id } as never);
  }
  log(`${customers.length} clients, ${leadSeed.length} prospects, 8 opportunités`);

  // ── Ventes : 6 mois d'historique ────────────────────────────
  const goods = products;
  const lineFor = (p: (typeof products)[number], qty: number) => ({ productId: p.id, description: p.name, unit: p.unit, quantity: qty, unitPrice: Number(p.salePrice), discountPct: qty >= 20 ? 3 : 0, taxId: tax.id });
  let invoiceCount = 0;
  const issueAndPay = async (customerId: string, daysAgo: number, lineSpec: [number, number][], paidRatio: number, method: "BANK_TRANSFER" | "CASH" | "MOBILE_MONEY" | "CHEQUE") => {
    const lines = lineSpec.map(([pi, q]) => lineFor(goods[pi % goods.length]!, q));
    const draft = await invoices.createInvoice(ctx, invoiceSchema.parse({ customerId, issueDate: dateStr(daysAgo), lines }));
    const inv = await invoices.issueInvoice(ctx, { id: draft.id, installments: 1, allowOverLimit: true });
    invoiceCount++;
    if (paidRatio > 0) {
      const full = await invoices.getInvoice(ctx, inv.id);
      const amount = paidRatio >= 1 ? invoices.invoiceBalance(full).toNumber() : Math.round((invoices.invoiceBalance(full).toNumber() * paidRatio) / 1000) * 1000;
      await payments.recordPayment(ctx, { invoiceId: inv.id, amount, method, date: dateStr(Math.max(0, daysAgo - 12)), reference: method === "CHEQUE" ? `CHQ-${1000 + invoiceCount}` : "", notes: "" } as never);
    }
    return inv;
  };
  const methods = ["BANK_TRANSFER", "CASH", "MOBILE_MONEY", "CHEQUE"] as const;
  for (let m = 5; m >= 0; m--) {
    const n = 3 + ((m + 2) % 3);
    for (let k = 0; k < n; k++) {
      const c = customers[(m * 3 + k) % customers.length]!;
      const days = m === 0 ? k * 2 : m * 30 + 4 + k * 6;
      const spec: [number, number][] = [[(m + k) % 10, 8 + k * 6], [(m * 2 + k + 3) % 18, 2 + k]];
      // anciennes factures : surtout payées ; récentes : partiellement ou non payées
      const ratio = m >= 3 ? (k === 0 && m === 3 ? 0 : 1) : m === 2 ? (k % 2 ? 1 : 0.5) : k % 3 === 0 ? 0 : k % 3 === 1 ? 0.4 : 1;
      await issueAndPay(c.id, days, spec, ratio, pick(methods, k + m));
    }
  }
  log(`${invoiceCount} factures avec paiements (dont échues)`);

  // ── Parcours complet : devis → commande → livraison → facture ─
  const cTop = customers[1]!;
  const q = await quotes.createQuote(ctx, quoteSchema.parse({ customerId: cTop.id, issueDate: dateStr(9), validUntil: dateStr(-21), notes: "Livraison sous 5 jours ouvrés.", terms: "Paiement à 30 jours fin de mois.", lines: [lineFor(goods[0]!, 120), lineFor(goods[1]!, 80), lineFor(goods[2]!, 40), { productId: transport.id, description: transport.name, unit: "forfait", quantity: 1, unitPrice: 25000, discountPct: 0, taxId: tax.id }] }));
  await quotes.setQuoteStatus(ctx, { id: q.id, status: "SENT" });
  await quotes.setQuoteStatus(ctx, { id: q.id, status: "ACCEPTED" });
  const o = await quotes.convertQuoteToOrder(ctx, q.id);
  const ord = await orders.getOrder(ctx, o.id);
  const dl = await orders.createDelivery(ctx, { orderId: o.id, warehouseId: main.id, deliveryDate: dateStr(4), notes: "", lines: ord.lines.filter((l) => l.productId !== transport.id).map((l) => ({ orderLineId: l.id, quantity: Number(l.quantity) / 2 })) } as never);
  await orders.confirmDelivery(ctx, dl.id);
  await quotes.createQuote(ctx, quoteSchema.parse({ customerId: customers[3]!.id, issueDate: dateStr(2), lines: [lineFor(goods[9]!, 60), lineFor(goods[10]!, 30)] }));
  const draftQ = await quotes.createQuote(ctx, quoteSchema.parse({ customerId: customers[5]!.id, issueDate: dateStr(0), lines: [lineFor(goods[6]!, 15), lineFor(goods[8]!, 20)] }));
  await quotes.setQuoteStatus(ctx, { id: draftQ.id, status: "SENT" });
  await quotes.createQuote(ctx, quoteSchema.parse({ kind: "PROFORMA", customerId: customers[7]!.id, issueDate: dateStr(1), lines: [lineFor(goods[15]!, 4), lineFor(goods[16]!, 3)] }));
  await orders.createOrder(ctx, orderSchema.parse({ customerId: customers[4]!.id, orderDate: dateStr(0), lines: [lineFor(goods[18]!, 20), lineFor(goods[19]!, 6)] }));
  log("devis, commandes, livraison partielle");

  // un avoir sur la première facture payée
  const firstPaid = await ctx.db.invoice.findFirst({ where: { status: "PAID" }, orderBy: { issueDate: "asc" }, include: { lines: true } });
  if (firstPaid && firstPaid.lines[0]) {
    const cn = await invoices.createCreditNote(ctx, { invoiceId: firstPaid.id, reason: "Retour de marchandise défectueuse", restock: false, lines: [{ invoiceLineId: firstPaid.lines[0].id, quantity: 1 }] });
    await invoices.issueCreditNote(ctx, cn.id);
  }
  return { skipped: false };
}

/**
 * Achats de démonstration : fournisseurs, demandes (dont une en attente de validation), commandes à tous les stades
 * (reçue + facturée + payée, partiellement payée, échue, en attente de réception, en attente d'approbation).
 * Passe par les services : numérotation, entrées en stock valorisées, dettes et approbations sont cohérentes.
 */
export async function seedPurchasingDemo(companyId: string, userId: string, requesterId: string) {
  const ctx = await loadContext(companyId, userId);
  if (!ctx.hasModule("purchases") || (await ctx.db.supplier.count()) > 0) return { skipped: true };
  const requester = await loadContext(companyId, requesterId);
  const log = (m: string) => console.log(`  • ${m}`);
  const today = new Date().toISOString().slice(0, 10);

  const supplierSpecs = [
    ["Cimenterie du Golfe SA", "Abidjan", "commercial@cimgolfe.ci", 30], ["Sidérurgie Ouest-Africaine", "Abidjan", "ventes@sido.ci", 45], ["Peintures Tropicales SARL", "Bouaké", "contact@peintures-tropicales.ci", 30],
    ["Import Outillage Plus", "Abidjan", "achats@outillage-plus.ci", 15], ["Carrière Kouassi & Frères", "Yamoussoukro", "kouassi.carriere@gmail.com", 0],
  ] as const;
  const suppliers = [];
  for (const [name, city, email, terms] of supplierSpecs) suppliers.push(await sup.createSupplier(ctx, supplierSchema.parse({ name, city, email, country: "CI", phone: "+225 07 00 00 00 00", paymentTermsDays: terms })));
  const [golfe, sido, peintures, outillage] = suppliers as [typeof suppliers[0], typeof suppliers[0], typeof suppliers[0], typeof suppliers[0]];

  const tax = await ctx.db.tax.findFirstOrThrow({ where: { isDefault: true } });
  const goods = await ctx.db.product.findMany({ where: { deletedAt: null, trackStock: true }, orderBy: { createdAt: "asc" } });
  const wh = (await inventory.listWarehouses(ctx))[0]!;
  const line = (p: (typeof goods)[number], quantity: number, unitPrice = Number(p.costPrice)) => ({ productId: p.id, description: p.name, unit: p.unit, quantity, unitPrice, discountPct: 0, taxId: tax.id });

  const place = async (supplierId: string, daysAgo: number, lines: ReturnType<typeof line>[]) => {
    const o = await proc.createOrder(ctx, purchaseOrderSchema.parse({ supplierId, orderDate: dateStr(daysAgo), expectedDate: dateStr(daysAgo - 7), warehouseId: wh.id, lines }));
    await proc.submitOrder(ctx, o.id);
    return o;
  };
  const receiveAll = async (orderId: string, daysAgo: number, ratio = 1) => {
    const o = await proc.getOrder(ctx, orderId);
    const rc = await proc.createReceipt(ctx, { orderId, warehouseId: wh.id, receiptDate: dateStr(daysAgo), notes: "", lines: o.lines.map((l) => ({ orderLineId: l.id, quantity: Math.floor(Number(l.quantity) * ratio) })) });
    await proc.confirmReceipt(ctx, rc.id);
  };

  // 1. Commande complète : reçue, facturée, payée
  const o1 = await place(golfe.id, 62, [line(goods[0]!, 300, 5000)]);
  await receiveAll(o1.id, 55);
  const b1 = await bills.postBill(ctx, (await bills.createBillFromOrder(ctx, o1.id)).id);
  await bills.recordSupplierPayment(ctx, { billId: b1.id, amount: Number(b1.total), method: "BANK_TRANSFER", date: dateStr(30), reference: "VIR-2026-0412" } as never);

  // 2. Facture partiellement payée
  const o2 = await place(sido.id, 40, [line(goods[1]!, 200, 5700), line(goods[2]!, 120, 8400)]);
  await receiveAll(o2.id, 33);
  const b2 = await bills.postBill(ctx, (await bills.createBillFromOrder(ctx, o2.id)).id);
  await bills.recordSupplierPayment(ctx, { billId: b2.id, amount: Math.round(Number(b2.total) * 0.4), method: "CHEQUE", date: dateStr(10), reference: "CHQ-558812" } as never);

  // 3. Facture échue non payée (délai fournisseur dépassé)
  const o3 = await place(peintures.id, 75, [line(goods[6]!, 40, 29000), line(goods[8]!, 50, 9300)]);
  await receiveAll(o3.id, 70);
  const d3 = await bills.createBillFromOrder(ctx, o3.id);
  await bills.postBill(ctx, d3.id);
  await ctx.db.supplierBill.update({ where: { id: d3.id }, data: { dueDate: new Date(Date.now() - 20 * DAY) } });

  // 4. Commande validée en attente de réception ; 5. réception partielle
  await place(outillage.id, 3, [line(goods[15]!, 10, 36000), line(goods[16]!, 8, 29500)]);
  const o5 = await place(golfe.id, 6, [line(goods[3]!, 4000, 235)]);
  await receiveAll(o5.id, 2, 0.5);

  // Règles de validation activées une fois l'historique en place (le passé n'est pas re-soumis)
  await savePolicy(ctx, { type: "purchase_request", isEnabled: true, threshold: 300000 });
  await savePolicy(ctx, { type: "purchase_order", isEnabled: true, threshold: 1500000 });

  // 6. Commande au-delà du seuil → approbation requise (demandée par un autre membre que l'administrateur)
  const o6 = await proc.createOrder(requester, purchaseOrderSchema.parse({ supplierId: sido.id, orderDate: today, expectedDate: dateStr(-10), warehouseId: wh.id, lines: [line(goods[2]!, 400, 8300), line(goods[1]!, 300, 5600)] }));
  await proc.submitOrder(requester, o6.id);

  // Demandes d'achat : approuvée automatiquement (sous le seuil), en attente de validation, brouillon
  const reqLines = (p: (typeof goods)[number], q: number) => ({ productId: p.id, description: p.name, unit: p.unit, quantity: q, estimatedPrice: Number(p.costPrice) });
  const rSmall = await proc.createRequest(requester, purchaseRequestSchema.parse({ reason: "Réassort quincaillerie", neededBy: dateStr(-5), lines: [reqLines(goods[12]!, 30), reqLines(goods[13]!, 10)] }));
  await proc.submitRequest(requester, rSmall.id);
  const rBig = await proc.createRequest(requester, purchaseRequestSchema.parse({ reason: "Stock toiture pour la saison des pluies", neededBy: dateStr(-14), lines: [reqLines(goods[9]!, 200), reqLines(goods[10]!, 120)] }));
  await proc.submitRequest(requester, rBig.id);
  await proc.createRequest(requester, purchaseRequestSchema.parse({ reason: "Outillage pour l'équipe de livraison", lines: [reqLines(goods[17]!, 6)] }));
  log("5 fournisseurs, 6 commandes (réceptions, factures, paiements), 3 demandes d'achat, 2 validations en attente");
  return { skipped: false };
}

/**
 * Finance de démonstration : soldes d'ouverture, compte mobile money, dépenses mensuelles payées depuis les comptes,
 * transferts, dépenses en attente de validation / brouillon, budgets de l'année. Les encaissements clients et règlements
 * fournisseurs des étapes précédentes ont déjà alimenté les comptes (événements). Appelé APRÈS les achats.
 */
export async function seedFinanceDemo(companyId: string, userId: string, requesterId: string) {
  const ctx = await loadContext(companyId, userId);
  if (!ctx.hasModule("finance") || (await ctx.db.expense.count()) > 0) return { skipped: true };
  const requester = await loadContext(companyId, requesterId);
  const log = (m: string) => console.log(`  • ${m}`);
  const accounts = await tr.listAccounts(ctx);
  const cash = accounts.find((a) => a.type === "CASH")!;
  const bank = accounts.find((a) => a.type === "BANK")!;
  const mobile = await tr.createAccount(ctx, { name: "Orange Money — pro", type: "MOBILE_MONEY", bankName: "Orange CI", accountNumber: "07 07 00 00 00", openingBalance: 0, isDefault: true } as never);
  const cats = new Map((await tr.listCategories(ctx, { kind: "EXPENSE" })).map((c) => [c.name, c.id]));
  const cat = (name: string) => cats.get(name) ?? [...cats.values()][0]!;
  const apport = (await tr.listCategories(ctx, { kind: "INCOME" })).find((c) => c.name === "Apport en capital")!.id;

  // Approvisionnement du compte mobile money, dépôt en banque et retrait de caisse
  await tr.createTransfer(ctx, { fromAccountId: bank.id, toAccountId: mobile.id, amount: 600000, date: dateStr(150), description: "Approvisionnement Orange Money" });
  await tr.createTransfer(ctx, { fromAccountId: bank.id, toAccountId: cash.id, amount: 800000, date: dateStr(120), description: "Retrait pour la caisse" });
  await tr.createManualTransaction(ctx, manualTransactionSchema.parse({ accountId: bank.id, type: "OUT", date: dateStr(60), amount: 18500, description: "Frais de tenue de compte", categoryId: cat("Frais bancaires") }));

  const monthly: [string, string, number, "BANK_TRANSFER" | "CASH" | "MOBILE_MONEY", string][] = [
    ["Loyer et charges locatives", "Loyer du dépôt et du siège", 260000, "BANK_TRANSFER", "Virement bailleur"],
    ["Électricité, eau, internet", "Électricité, eau et internet", 48000, "CASH", "Factures CIE / SODECI / Orange"],
    ["Transport et carburant", "Carburant des véhicules de livraison", 85000, "MOBILE_MONEY", "Carburant"],
    ["Marketing et publicité", "Publicité Facebook et radio locale", 30000, "MOBILE_MONEY", "Campagne mensuelle"],
  ];
  const payable = { CASH: cash.id, BANK_TRANSFER: bank.id, MOBILE_MONEY: mobile.id } as const;
  for (let m = 5; m >= 0; m--) {
    for (const [category, description, base, method, ref] of monthly) {
      const jitter = 1 + (((m * 7 + description.length) % 9) - 4) / 50; // ±8 % de variation réaliste
      const amount = Math.round((base * jitter) / 500) * 500;
      const e = await ex.createExpense(ctx, expenseSchema.parse({ date: dateStr(m * 30 + 3), categoryId: cat(category), description: `${description} — M-${m}`, amount, method, reference: ref }));
      await ex.submitExpense(ctx, e.id);
      if (method !== "BANK_TRANSFER" && m < 4) await tr.createManualTransaction(ctx, manualTransactionSchema.parse({ accountId: payable[method], type: "IN", date: dateStr(m * 30 + 4), amount: Math.round(amount * 1.1), description: method === "CASH" ? "Versement de l'associé en caisse" : "Rechargement Orange Money par l'associé", categoryId: apport }));
      await ex.payExpense(ctx, { id: e.id, accountId: payable[method], date: dateStr(m * 30 + 2), method, reference: ref } as never);
    }
  }

  // Règle de validation des dépenses : activée après l'historique
  await savePolicy(ctx, { type: "expense", isEnabled: true, threshold: 500000 });
  const big = await ex.createExpense(requester, expenseSchema.parse({ date: dateStr(0), categoryId: cat("Entretien et réparations"), description: "Réparation du camion de livraison (devis garage Kouamé)", amount: 1_250_000, method: "BANK_TRANSFER", reference: "Devis 2026-118" }));
  await ex.submitExpense(requester, big.id);
  const small = await ex.createExpense(requester, expenseSchema.parse({ date: dateStr(1), categoryId: cat("Fournitures de bureau"), description: "Papier, toners et fournitures", amount: 78500, method: "CASH" }));
  await ex.submitExpense(requester, small.id);
  await ex.createExpense(requester, expenseSchema.parse({ date: dateStr(0), categoryId: cat("Déplacements et missions"), description: "Mission commerciale à Bouaké", amount: 145000, method: "CASH" }));

  // Budgets de l'année
  const year = new Date().getFullYear();
  for (const [name, monthlyBudget] of [["Loyer et charges locatives", 270000], ["Électricité, eau, internet", 55000], ["Transport et carburant", 90000], ["Marketing et publicité", 35000], ["Entretien et réparations", 60000]] as const) {
    await rp.saveBudget(ctx, budgetSchema.parse({ year, categoryId: cat(name), months: Array(12).fill(monthlyBudget) }));
  }
  // Inventaire intermittent : en fin de période, la variation de stocks (stock final − stock initial) est constatée par une écriture
  {
    const fy = (await accRep.defaultFiscalYear(ctx))!;
    const closing = await stockValue(ctx);
    const opening = (await accRep.trialBalance(ctx, { fiscalYearId: fy.id })).rows.find((r) => r.code === "311")?.balance.toNumber() ?? 0;
    const variation = closing - opening;
    const od = (await acc.listJournals(ctx)).find((j) => j.code === "OD")!;
    const ledger = await acc.listLedgerAccounts(ctx);
    const id = (code: string) => ledger.find((x) => x.code === code)!.id;
    if (variation !== 0) {
      const entry = await acc.createManualEntry(ctx, { journalId: od.id, date: dateStr(0), description: "Inventaire : variation des stocks de marchandises", reference: "Inventaire", lines: variation > 0
        ? [{ ledgerAccountId: id("311"), label: "Augmentation du stock", debit: variation, credit: 0 }, { ledgerAccountId: id("6031"), label: "Variation des stocks de marchandises", debit: 0, credit: variation }]
        : [{ ledgerAccountId: id("6031"), label: "Variation des stocks de marchandises", debit: -variation, credit: 0 }, { ledgerAccountId: id("311"), label: "Diminution du stock", debit: 0, credit: -variation }] } as never);
      await acc.validateManualEntry(ctx, entry.id);
    }
  }
  log("comptes (banque, caisse, mobile money), 24 dépenses payées, 3 dépenses en cours, transferts, budgets");
  return { skipped: false };
}
