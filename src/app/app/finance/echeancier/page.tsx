import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { cashForecast, dueSchedule } from "@/modules/finance/reports";

export const metadata: Metadata = { title: "Échéancier" };

export default async function SchedulePage() {
  const ctx = await requirePagePermission("finance.account.read");
  const [due, forecast] = await Promise.all([dueSchedule(ctx), cashForecast(ctx)]);
  const cur = ctx.company.currency;
  const sections = [
    { title: "À encaisser (clients)", note: ctx.hasModule("sales") && ctx.can("finance.invoice.read") ? null : "Nécessite le module Ventes et le droit de consulter les factures.", groups: due.receivables, tone: "" },
    { title: "À payer (fournisseurs)", note: ctx.hasModule("purchases") && ctx.can("purchases.bill.read") ? null : "Nécessite le module Achats et le droit de consulter les factures fournisseur.", groups: due.payables, tone: "" },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Trésorerie prévisionnelle</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-4">
            <div><p className="text-xs text-muted-foreground">Aujourd'hui</p><p className="text-lg font-semibold tabular">{formatMoney(forecast.current, cur)}</p></div>
            {forecast.points.map((p) => (
              <div key={p.days}><p className="text-xs text-muted-foreground">Dans {p.days} jours</p><p className={`text-lg font-semibold tabular ${p.balance < 0 ? "text-destructive" : ""}`}>{formatMoney(p.balance, cur)}</p><p className="text-xs text-muted-foreground tabular">+ {formatMoney(p.in, cur)} / − {formatMoney(p.out, cur)}</p></div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Estimation : solde actuel + créances − dettes échues d'ici l'horizon (les retards sont supposés réglés). Elle ne tient pas compte des dépenses récurrentes futures ni des ventes non encore facturées.</p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {sections.map((s) => (
          <Card key={s.title}>
            <CardHeader><CardTitle className="text-base">{s.title}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {s.note && <p className="text-sm text-muted-foreground">{s.note}</p>}
              {!s.note && s.groups.every((g) => g.rows.length === 0) && <p className="text-sm text-muted-foreground">Rien d'ouvert.</p>}
              {!s.note && s.groups.filter((g) => g.rows.length > 0).map((g) => (
                <section key={g.key} aria-label={g.label}>
                  <h4 className={`mb-1 flex justify-between text-xs font-semibold uppercase tracking-wide ${g.key === "overdue" ? "text-destructive" : "text-muted-foreground"}`}><span>{g.label}</span><span className="tabular">{formatMoney(g.total, cur)}</span></h4>
                  <ul className="divide-y rounded-md border">
                    {g.rows.slice(0, 8).map((r) => (
                      <li key={r.id}><Link href={r.href} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50"><span className="min-w-0 flex-1 truncate">{r.label} · {r.party}</span><span className="text-xs text-muted-foreground">{fmtDate(r.dueDate)}</span><span className="tabular">{formatMoney(r.balance, cur)}</span></Link></li>
                    ))}
                    {g.rows.length > 8 && <li className="px-3 py-2 text-xs text-muted-foreground">… et {g.rows.length - 8} autre{g.rows.length - 8 > 1 ? "s" : ""}</li>}
                  </ul>
                </section>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
