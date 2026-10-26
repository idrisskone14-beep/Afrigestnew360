import "server-only";
import { platformDb, platformTransaction } from "@/core/db/client";
import { businessRule, notFound } from "@/core/errors";
import { appUrl } from "@/core/mail";
import { roundMoney } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { applyPlanModules } from "@/core/tenant/provisioning";
import { confirmInvoice, createInvoice, paydunyaConfig, PaydunyaError } from "@/modules/billing/paydunya";

export type Cycle = "MONTHLY" | "YEARLY";

const BILLING_PATH = "/app/parametres/abonnement";

export const isPaymentConfigured = () => paydunyaConfig() !== null;

/** Offres payables en ligne : publiques, actives et facturées (une offre à 0 n'a rien à encaisser). */
export async function listPayablePlans() {
  const plans = await platformDb.plan.findMany({ where: { isActive: true, isPublic: true }, orderBy: { sortOrder: "asc" } });
  return plans.filter((p) => p.priceMonthly.gt(0) || p.priceYearly.gt(0));
}

const priceOf = (plan: { priceMonthly: { toString(): string }; priceYearly: { toString(): string }; currency: string }, cycle: Cycle) =>
  roundMoney(cycle === "YEARLY" ? plan.priceYearly : plan.priceMonthly, plan.currency);

/**
 * Démarre le règlement d'un abonnement : enregistre un paiement EN ATTENTE puis crée la facture PayDunya.
 * Le montant vient TOUJOURS de l'offre en base, jamais du navigateur. Renvoie l'adresse de la page de paiement.
 */
export async function startSubscriptionPayment(ctx: TenantContext, input: { planId: string; cycle: Cycle }): Promise<{ url: string }> {
  const cfg = paydunyaConfig();
  if (!cfg) throw businessRule("Le paiement en ligne n'est pas encore activé. Contactez votre gestionnaire de compte KAKO Gestion.");
  const plan = await platformDb.plan.findFirst({ where: { id: input.planId, isActive: true, isPublic: true } });
  if (!plan) throw notFound("Offre");
  const amount = priceOf(plan, input.cycle);
  if (amount.lte(0)) throw businessRule("Cette offre n'a pas de tarif pour la périodicité choisie.");
  if (plan.currency !== "XOF") throw businessRule("Le paiement en ligne n'accepte que le franc CFA (XOF).");

  const payment = await platformDb.subscriptionPayment.create({
    data: { companyId: ctx.company.id, planId: plan.id, billingCycle: input.cycle, amount: amount.toString(), currency: plan.currency, createdById: ctx.user.id },
  });
  const label = `Abonnement KAKO Gestion — offre ${plan.name} (${input.cycle === "YEARLY" ? "1 an" : "1 mois"})`;
  try {
    const invoice = await createInvoice(cfg, {
      amount: amount.toNumber(),
      description: label,
      storeName: "KAKO Gestion",
      websiteUrl: appUrl(),
      returnUrl: appUrl(`${BILLING_PATH}?paiement=${payment.id}`),
      cancelUrl: appUrl(`${BILLING_PATH}?paiement=${payment.id}`),
      callbackUrl: appUrl("/api/paydunya/ipn"),
      customData: { payment_id: payment.id },
    });
    await platformDb.subscriptionPayment.update({ where: { id: payment.id }, data: { providerToken: invoice.token, paymentUrl: invoice.url } });
    return { url: invoice.url };
  } catch (e) {
    await platformDb.subscriptionPayment.update({ where: { id: payment.id }, data: { status: "FAILED", failReason: e instanceof Error ? e.message.slice(0, 300) : "Erreur inconnue" } });
    if (e instanceof PaydunyaError) {
      console.error("[billing:paydunya]", e.message);
      throw businessRule("Le service de paiement est momentanément indisponible. Réessayez dans quelques minutes.");
    }
    throw e;
  }
}

const addMonths = (from: Date, months: number) => {
  const out = new Date(from);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
};

/**
 * Relit l'état d'un paiement auprès de PayDunya et, s'il est réglé, active l'abonnement. IDEMPOTENT : appelée par la
 * notification (IPN), par le retour du client et par le bouton « Vérifier », elle n'applique le règlement qu'UNE fois
 * (passage atomique PENDING → COMPLETED). L'état et le montant viennent de PayDunya, jamais de la requête reçue.
 */
export async function settlePayment(where: { token: string } | { id: string; companyId: string }) {
  const payment = await platformDb.subscriptionPayment.findFirst({ where: "token" in where ? { providerToken: where.token } : where });
  if (!payment || payment.status !== "PENDING" || !payment.providerToken) return payment;
  const cfg = paydunyaConfig();
  if (!cfg) return payment;

  const state = await confirmInvoice(cfg, payment.providerToken);
  if (state.status === "pending") return payment;
  if (state.status !== "completed") {
    const status = state.status === "cancelled" ? "CANCELED" : "FAILED";
    return platformDb.subscriptionPayment.update({ where: { id: payment.id }, data: { status, failReason: state.failReason?.slice(0, 300) ?? null } });
  }

  // garde-fous : même paiement, même montant que celui enregistré à la création
  const sameId = state.customData.payment_id === payment.id;
  const sameAmount = state.totalAmount !== null && roundMoney(state.totalAmount, payment.currency).equals(payment.amount.toString());
  if (!sameId || !sameAmount) {
    console.error(`[billing:paydunya] incohérence sur le paiement ${payment.id} (identifiant ou montant) : non appliqué`);
    return platformDb.subscriptionPayment.update({ where: { id: payment.id }, data: { status: "FAILED", failReason: "Incohérence entre le paiement attendu et celui confirmé : vérification manuelle requise." } });
  }

  return platformTransaction(async (tx) => {
    const claimed = await tx.subscriptionPayment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: "COMPLETED", paidAt: new Date(), receiptUrl: state.receiptUrl },
    });
    if (claimed.count === 1) {
      const [sub, plan] = await Promise.all([
        tx.subscription.findUnique({ where: { companyId: payment.companyId } }),
        tx.plan.findUniqueOrThrow({ where: { id: payment.planId } }),
      ]);
      if (!sub) throw notFound("Abonnement");
      const now = new Date();
      // renouvellement de la même offre encore en cours : la période s'ajoute à la fin de l'actuelle ; sinon elle démarre maintenant
      const renewing = sub.status === "ACTIVE" && sub.planId === plan.id && sub.currentPeriodEnd > now;
      const start = renewing ? sub.currentPeriodEnd : now;
      await tx.subscription.update({
        where: { companyId: payment.companyId },
        data: {
          planId: plan.id, billingCycle: payment.billingCycle, status: "ACTIVE", priceAmount: payment.amount, currency: payment.currency,
          currentPeriodStart: renewing ? sub.currentPeriodStart : now, currentPeriodEnd: addMonths(start, payment.billingCycle === "YEARLY" ? 12 : 1),
          trialEndsAt: null, canceledAt: null,
        },
      });
      await applyPlanModules(tx, payment.companyId, plan.id);
    }
    return tx.subscriptionPayment.findUniqueOrThrow({ where: { id: payment.id } });
  });
}
