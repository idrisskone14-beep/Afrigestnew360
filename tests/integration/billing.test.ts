import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { platformDb } from "@/core/db/client";
import { settlePayment, startSubscriptionPayment } from "@/modules/platform/billing";
import { ctxFor, makeCompany } from "../helpers";

/** PayDunya simulé : `invoiceState` est ce que renverrait « checkout-invoice/confirm » pour le jeton créé. */
let invoiceState: Record<string, unknown> = {};
const calls: { url: string; method: string }[] = [];

function fakePaydunya() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { method: string }) => {
    calls.push({ url, method: init.method });
    if (url.endsWith("/checkout-invoice/create")) return Response.json({ response_code: "00", response_text: "https://paydunya.test/pay/abc", token: "test_tok_123456", description: "Checkout Invoice Created" });
    return Response.json({ response_code: "00", ...invoiceState });
  }));
}

async function setup(price = { monthly: 25000, yearly: 250000 }) {
  const co = await makeCompany("PAY", "enterprise");
  await platformDb.plan.update({ where: { code: "enterprise" }, data: { priceMonthly: price.monthly, priceYearly: price.yearly, currency: "XOF", isPublic: true, isActive: true } });
  const plan = await platformDb.plan.findUniqueOrThrow({ where: { code: "enterprise" } });
  const ctx = await ctxFor(co.owner.id, co.company.id);
  return { ...co, ctx, plan };
}

const completed = (id: string, amount: number) => ({ status: "completed", invoice: { total_amount: amount }, custom_data: { payment_id: id }, receipt_url: "https://paydunya.test/receipt.pdf" });

describe("paiement des abonnements (PayDunya)", () => {
  // l'offre « enterprise » est partagée avec les autres fichiers de tests : on la remet dans son état d'origine
  let original: { priceMonthly: unknown; priceYearly: unknown; currency: string; isPublic: boolean; isActive: boolean };
  beforeAll(async () => { original = await platformDb.plan.findUniqueOrThrow({ where: { code: "enterprise" } }); });
  afterAll(async () => { await platformDb.plan.update({ where: { code: "enterprise" }, data: { priceMonthly: original.priceMonthly as never, priceYearly: original.priceYearly as never, currency: original.currency, isPublic: original.isPublic, isActive: original.isActive } }); });

  beforeEach(() => {
    calls.length = 0;
    invoiceState = {};
    process.env.PAYDUNYA_MASTER_KEY = "master-test";
    process.env.PAYDUNYA_PRIVATE_KEY = "private-test";
    process.env.PAYDUNYA_TOKEN = "token-test";
    fakePaydunya();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ["PAYDUNYA_MASTER_KEY", "PAYDUNYA_PRIVATE_KEY", "PAYDUNYA_TOKEN"]) delete process.env[k];
  });

  it("le montant vient de l'offre en base ; le paiement reste EN ATTENTE jusqu'à confirmation", async () => {
    const s = await setup();
    const { url } = await startSubscriptionPayment(s.ctx, { planId: s.plan.id, cycle: "YEARLY" });
    expect(url).toBe("https://paydunya.test/pay/abc");
    const p = await platformDb.subscriptionPayment.findFirstOrThrow({ where: { companyId: s.company.id } });
    expect(p).toMatchObject({ status: "PENDING", providerToken: "test_tok_123456", billingCycle: "YEARLY", currency: "XOF" });
    expect(Number(p.amount)).toBe(250000);

    invoiceState = { status: "pending", invoice: { total_amount: 250000 }, custom_data: { payment_id: p.id } };
    expect((await settlePayment({ token: "test_tok_123456" }))?.status).toBe("PENDING");
    const sub = await platformDb.subscription.findUniqueOrThrow({ where: { companyId: s.company.id } });
    expect(sub.status).not.toBe("ACTIVE");
  });

  it("paiement confirmé : abonnement activé pour la période payée, une seule fois même si la notification arrive deux fois", async () => {
    const s = await setup();
    await startSubscriptionPayment(s.ctx, { planId: s.plan.id, cycle: "MONTHLY" });
    const p = await platformDb.subscriptionPayment.findFirstOrThrow({ where: { companyId: s.company.id } });
    invoiceState = completed(p.id, 25000);

    const first = await settlePayment({ token: "test_tok_123456" });
    expect(first).toMatchObject({ status: "COMPLETED", receiptUrl: "https://paydunya.test/receipt.pdf" });
    const sub1 = await platformDb.subscription.findUniqueOrThrow({ where: { companyId: s.company.id } });
    expect(sub1).toMatchObject({ status: "ACTIVE", billingCycle: "MONTHLY", trialEndsAt: null });
    expect(Number(sub1.priceAmount)).toBe(25000);
    expect(sub1.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now() + 27 * 86_400_000);

    await settlePayment({ token: "test_tok_123456" }); // notification en double
    const sub2 = await platformDb.subscription.findUniqueOrThrow({ where: { companyId: s.company.id } });
    expect(sub2.currentPeriodEnd.getTime()).toBe(sub1.currentPeriodEnd.getTime());
    expect(calls.filter((c) => c.url.includes("/confirm/"))).toHaveLength(1); // déjà réglé : plus d'appel à PayDunya
  });

  it("un renouvellement s'ajoute à la fin de la période en cours", async () => {
    const s = await setup();
    const end = new Date(Date.now() + 10 * 86_400_000);
    await platformDb.subscription.update({ where: { companyId: s.company.id }, data: { planId: s.plan.id, status: "ACTIVE", currentPeriodEnd: end } });
    await startSubscriptionPayment(s.ctx, { planId: s.plan.id, cycle: "MONTHLY" });
    const p = await platformDb.subscriptionPayment.findFirstOrThrow({ where: { companyId: s.company.id } });
    invoiceState = completed(p.id, 25000);
    await settlePayment({ token: "test_tok_123456" });
    const sub = await platformDb.subscription.findUniqueOrThrow({ where: { companyId: s.company.id } });
    const days = (sub.currentPeriodEnd.getTime() - end.getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(31);
  });

  it("un montant ou un identifiant qui ne correspond pas n'active rien", async () => {
    const s = await setup();
    await startSubscriptionPayment(s.ctx, { planId: s.plan.id, cycle: "MONTHLY" });
    const p = await platformDb.subscriptionPayment.findFirstOrThrow({ where: { companyId: s.company.id } });
    invoiceState = completed(p.id, 100); // montant inférieur à celui attendu
    expect((await settlePayment({ token: "test_tok_123456" }))?.status).toBe("FAILED");
    const sub = await platformDb.subscription.findUniqueOrThrow({ where: { companyId: s.company.id } });
    expect(sub.status).not.toBe("ACTIVE");
  });

  it("paiement annulé ou refusé : statut mis à jour, abonnement inchangé", async () => {
    const s = await setup();
    await startSubscriptionPayment(s.ctx, { planId: s.plan.id, cycle: "MONTHLY" });
    const p = await platformDb.subscriptionPayment.findFirstOrThrow({ where: { companyId: s.company.id } });
    invoiceState = { status: "cancelled", invoice: { total_amount: 25000 }, custom_data: { payment_id: p.id } };
    expect((await settlePayment({ token: "test_tok_123456" }))?.status).toBe("CANCELED");
  });

  it("jeton inconnu ignoré ; une entreprise ne peut pas régler le paiement d'une autre", async () => {
    const a = await setup();
    const b = await makeCompany("PAY-B", "enterprise");
    expect(await settlePayment({ token: "jeton_inconnu_000" })).toBeNull();
    await startSubscriptionPayment(a.ctx, { planId: a.plan.id, cycle: "MONTHLY" });
    const p = await platformDb.subscriptionPayment.findFirstOrThrow({ where: { companyId: a.company.id } });
    expect(await settlePayment({ id: p.id, companyId: b.company.id })).toBeNull();
  });

  it("sans clés PayDunya : refus explicite, rien n'est créé ; offre gratuite refusée", async () => {
    const s = await setup();
    delete process.env.PAYDUNYA_TOKEN;
    await expect(startSubscriptionPayment(s.ctx, { planId: s.plan.id, cycle: "MONTHLY" })).rejects.toThrow(/pas encore activé/);
    process.env.PAYDUNYA_TOKEN = "token-test";
    await platformDb.plan.update({ where: { id: s.plan.id }, data: { priceMonthly: 0 } });
    await expect(startSubscriptionPayment(s.ctx, { planId: s.plan.id, cycle: "MONTHLY" })).rejects.toThrow(/pas de tarif/);
    expect(await platformDb.subscriptionPayment.count({ where: { companyId: s.company.id } })).toBe(0);
  });

  it("isolation : une entreprise ne voit que ses paiements", async () => {
    const a = await setup();
    const b = await makeCompany("PAY-B", "enterprise");
    await startSubscriptionPayment(a.ctx, { planId: a.plan.id, cycle: "MONTHLY" });
    const bctx = await ctxFor(b.owner.id, b.company.id);
    expect(await bctx.db.subscriptionPayment.count()).toBe(0);
    expect(await a.ctx.db.subscriptionPayment.count()).toBe(1);
  });
});
