import { Card, CardContent } from "@/components/ui/card";
import { fmtDate } from "@/lib/format";
import type { leaveBalances } from "../leave";

type Balance = Awaited<ReturnType<typeof leaveBalances>>[number];
const nb = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(n);

/** Solde d'un type de congé : reste, droit de l'année, report (avec son échéance), acquis à ce jour (acquisition progressive), en attente. */
export function BalanceCard({ b, label, compact = false }: { b: Balance; label?: string; compact?: boolean }) {
  const parts: string[] = [];
  if (b.entitlement) parts.push(`droit ${nb(b.entitlement.toNumber())} j`);
  if (b.carryOver > 0) parts.push(`dont report ${nb(b.carryOver)} j${b.carryExpiresOn ? ` (à prendre avant le ${fmtDate(b.carryExpiresOn)})` : ""}`);
  parts.push(`${nb(b.taken.toNumber())} pris`);
  if (b.pending.toNumber() > 0) parts.push(`${nb(b.pending.toNumber())} en attente`);
  return (
    <Card>
      <CardContent className={compact ? "space-y-0.5 p-4" : "space-y-1 p-5"}>
        <p className={compact ? "text-xs text-muted-foreground" : "text-sm text-muted-foreground"}>{label ?? b.type.name}</p>
        <p className={`${compact ? "text-lg" : "text-2xl"} font-semibold tabular`}>{b.remaining ? `${nb(b.remaining.toNumber())} j restants` : `${nb(b.taken.toNumber())} j pris`}</p>
        <p className="text-xs text-muted-foreground">{parts.join(" · ")}</p>
        {b.type.accrual === "MONTHLY" && b.accrued !== null && <p className="text-xs text-muted-foreground">Acquis à ce jour : <strong className="text-foreground">{nb(b.accrued)} j</strong> (acquisition progressive)</p>}
      </CardContent>
    </Card>
  );
}
