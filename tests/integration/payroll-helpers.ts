import { trialBalance, defaultFiscalYear } from "@/modules/accounting/reports";
import type { TenantContext } from "@/core/tenant/context";

/** Balance générale de l'exercice courant, soldes en nombres (débit − crédit). */
export async function getTrialBalance(s: { ctx: TenantContext }) {
  const fy = (await defaultFiscalYear(s.ctx))!;
  const tb = await trialBalance(s.ctx, { fiscalYearId: fy.id });
  return { balanced: tb.balanced, rows: tb.rows.map((r) => ({ code: r.code, balance: r.balance.toNumber() })) };
}
