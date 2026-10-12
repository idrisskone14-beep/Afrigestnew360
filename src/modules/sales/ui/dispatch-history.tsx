import { Mail, MailCheck, MailX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/app/status-badge";
import { fmtDateTime } from "@/lib/format";

interface Row { id: string; toEmail: string; subject: string; status: "SENT" | "FAILED"; error: string | null; sentAt: Date }

/** Historique des envois d'un document par e-mail (réussis et en échec). */
export function DispatchHistory({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Mail className="size-4 text-muted-foreground" /> Envois par e-mail</CardTitle></CardHeader>
      <CardContent className="divide-y p-0">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-3 text-sm">
            <span className="min-w-0 flex-1 truncate"><span className="font-medium">{r.toEmail}</span><span className="block truncate text-xs text-muted-foreground">{r.subject}{r.error ? ` — ${r.error}` : ""}</span></span>
            <span className="text-xs text-muted-foreground">{fmtDateTime(r.sentAt)}</span>
            <StatusBadge tone={r.status === "SENT" ? "success" : "danger"}>{r.status === "SENT" ? "Envoyé" : "Échec"}</StatusBadge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Pastille « Envoi » des listes : enveloppe pleine si le document est parti par e-mail, barrée sinon. */
export function SentCell({ at, applicable = true }: { at: Date | null; applicable?: boolean }) {
  if (!applicable) return <span className="text-muted-foreground">—</span>;
  const label = at ? `Envoyé le ${fmtDateTime(at)}` : "Pas encore envoyé";
  return (
    <span title={label} className={at ? "inline-grid size-8 place-items-center rounded-md bg-brand-blue/10 text-brand-blue" : "inline-grid size-8 place-items-center rounded-md bg-warning/15 text-warning"}>
      {at ? <MailCheck className="size-4" aria-hidden="true" /> : <MailX className="size-4" aria-hidden="true" />}
      <span className="sr-only">{label}</span>
    </span>
  );
}
