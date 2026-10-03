import "server-only";
import { businessRule } from "@/core/errors";
import { formatMoney } from "@/lib/reference-data";
import type { TenantContext } from "@/core/tenant/context";
import { customerBalance } from "./invoices";

/**
 * Garde-fous d'archivage d'un client fournis par les modules aval : pas d'archivage avec un solde dû
 * ou des factures en brouillon (le CRM reste indépendant des Ventes, qui s'y branche ici).
 */
export const customerArchiveGuards: ((ctx: TenantContext, customerId: string) => Promise<void>)[] = [
  async (ctx, customerId) => {
    if (!ctx.hasModule("sales")) return;
    const { outstanding } = await customerBalance(ctx, customerId);
    if (outstanding.gt(0)) throw businessRule(`Ce client a un solde impayé de ${formatMoney(outstanding.toNumber(), ctx.company.currency)} : soldez ses factures avant de l'archiver.`);
    const drafts = await ctx.db.invoice.count({ where: { customerId, status: "DRAFT" } });
    if (drafts > 0) throw businessRule("Ce client a des factures en brouillon : supprimez-les ou émettez-les avant l'archivage.");
  },
];
