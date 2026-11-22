import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { d } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { formatMoney } from "@/lib/reference-data";
import { hrPayrollPreview } from "../payroll-link";

const KIND: Record<string, string> = { OVERTIME: "Heures supplémentaires payées", ADVANCE: "Retenue d'avance" };

/**
 * « Éléments RH » d'une campagne : brouillon → aperçu de ce que le calcul intègre (permissions non rémunérées, absences retenues, heures supplémentaires,
 * retenues d'avance) ; campagne validée ou payée → ce qui a été retenu. Rien n'est intégré tant que l'entreprise n'a pas activé la liaison.
 */
export async function PayrollHrPanel({ ctx, run }: { ctx: TenantContext; run: { id: string; year: number; month: number; status: string; currency: string } }) {
  if (!ctx.hasModule("hr")) return null;
  if (run.status === "DRAFT") {
    const p = await hrPayrollPreview(ctx, run.year, run.month);
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Éléments RH intégrés au calcul</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!p.enabled && <p className="text-muted-foreground">La liaison RH → paie est désactivée : aucun élément RH n&apos;est intégré. Activez-la, rubrique par rubrique, avec « Éléments RH » (page Paie).</p>}
          {p.enabled && p.rows.length === 0 && <p className="text-muted-foreground">Aucun élément RH à intégrer pour cette période.</p>}
          {p.rows.map((r) => (
            <div key={r.employeeId} className="rounded-md border p-3">
              <p className="font-medium">{r.name} <span className="text-xs font-normal text-muted-foreground">{r.number}</span></p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {r.vars.lines.map((l, i) => <li key={i}>• {l.label} — {l.detail}</li>)}
                {r.vars.warnings.map((w, i) => <li key={`w${i}`} className="text-warning">⚠ {w}</li>)}
              </ul>
            </div>
          ))}
          {p.enabled && <p className="text-xs text-muted-foreground">Les arrêts maladie ne sont jamais retenus ni indemnisés par la paie (règles à valider). Les heures payées et les retenues d&apos;avance ne sont enregistrées qu&apos;à la validation de la campagne, et se défont si elle est annulée.</p>}
        </CardContent>
      </Card>
    );
  }
  const links = await ctx.db.payrollHrLink.findMany({ where: { runId: run.id }, orderBy: { createdAt: "asc" } });
  if (links.length === 0) return null;
  const emps = await ctx.db.employee.findMany({ where: { id: { in: [...new Set(links.map((l) => l.employeeId))] } }, select: { id: true, firstName: true, lastName: true } });
  const name = new Map(emps.map((e) => [e.id, `${e.lastName} ${e.firstName}`]));
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Éléments RH retenus par cette campagne</CardTitle></CardHeader>
      <CardContent className="divide-y p-0 text-sm">
        {links.map((l) => <div key={l.id} className="flex flex-wrap justify-between gap-2 px-6 py-2"><span>{name.get(l.employeeId) ?? "—"} — {KIND[l.kind]}{l.hours ? ` (${Number(l.hours)} h)` : ""}</span><span className="tabular">{formatMoney(d(l.amount).toNumber(), run.currency)}</span></div>)}
      </CardContent>
    </Card>
  );
}
