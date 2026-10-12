import Link from "next/link";
import { HandCoins } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Status } from "@/components/app/status-badge";
import { d } from "@/core/money";
import { formatMoney } from "@/lib/reference-data";

interface Row { id: string; number: string | null; status: string; total: unknown; deductedInId: string | null }

/** Acomptes facturés sur un devis ou une commande, avec leur état de déduction sur la facture finale. */
export function DepositsCard({ rows, currency }: { rows: Row[]; currency: string }) {
  if (rows.length === 0) return null;
  const sum = rows.reduce((a, r) => a.plus(d(r.total as number)), d(0)).toNumber();
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><HandCoins className="size-4 text-muted-foreground" /> Acomptes facturés · {formatMoney(sum, currency)}</CardTitle></CardHeader>
      <CardContent className="divide-y p-0">
        {rows.map((r) => (
          <Link key={r.id} href={`/app/sales/factures/${r.id}`} className="flex items-center gap-3 px-6 py-3 text-sm hover:bg-muted/50">
            <span className="flex-1 font-medium">{r.number ?? "Brouillon"}</span>
            <span className="text-xs text-muted-foreground">{r.deductedInId ? "déduit de la facture finale" : "à déduire de la facture finale"}</span>
            <span className="tabular">{formatMoney(d(r.total as number).toNumber(), currency)}</span>
            <Status value={r.status} />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
