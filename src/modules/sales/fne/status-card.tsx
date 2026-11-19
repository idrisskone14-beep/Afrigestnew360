import { BadgeCheck, ExternalLink } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDate } from "@/lib/format";
import { certifyCreditNoteAction } from "./actions";
import type { FnePaymentMethod, FneTemplate } from "./schemas";
import { CertifyInvoiceDialog } from "./ui";

interface FneDoc { id: string; fneStatus: string | null; fneReference: string | null; fneVerifyUrl: string | null; fneError: string | null; fneCertifiedAt: Date | null }

/**
 * État de certification FNE d'une facture ou d'un avoir émis, avec l'action de certification (ou de nouvelle tentative).
 * N'affiche rien quand la FNE est inactive et que le document n'a jamais été soumis.
 */
export function FneStatusCard({ kind, doc, enabled, canCertify, invoiceDefaults, blockedReason }: {
  kind: "invoice" | "credit-note";
  doc: FneDoc;
  enabled: boolean;
  canCertify: boolean;
  invoiceDefaults?: { template: FneTemplate; payment: FnePaymentMethod };
  /** Raison pour laquelle la certification n'est pas proposée (ex. facture d'origine non certifiée). */
  blockedReason?: string;
}) {
  const s = doc.fneStatus;
  if (!s && !enabled) return null;
  const noun = kind === "invoice" ? "Facture" : "Avoir";

  const action = (retry: boolean, uncertain: boolean) => {
    if (!canCertify || !enabled) return null;
    if (blockedReason) return <p className="text-sm text-muted-foreground">{blockedReason}</p>;
    if (kind === "invoice") return <CertifyInvoiceDialog id={doc.id} template={invoiceDefaults?.template ?? "B2C"} payment={invoiceDefaults?.payment ?? "deferred"} retry={retry} uncertain={uncertain} />;
    return (
      <ActionButton action={certifyCreditNoteAction} input={{ id: doc.id }} variant={retry ? "outline" : "default"} label={retry ? "Relancer la certification FNE" : "Certifier auprès de la FNE"} icon={<BadgeCheck className="size-4" />} success="Avoir certifié FNE"
        confirm={uncertain ? { title: "Relancer la certification ?", description: "La tentative précédente n'a pas reçu de réponse : l'avoir a peut-être déjà été certifié. Vérifiez dans votre espace FNE avant de confirmer, pour éviter un doublon.", confirmLabel: "J'ai vérifié, relancer" } : undefined} />
    );
  };

  return (
    <Card aria-label="Certification FNE">
      <CardContent className="flex flex-wrap items-start gap-4 p-4">
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          {s === "CERTIFIED" ? (
            <>
              <p className="flex items-center gap-1.5 font-medium text-success"><BadgeCheck className="size-4" /> {noun} certifié{kind === "invoice" ? "e" : ""} FNE</p>
              <p>N° FNE <span className="font-medium tabular">{doc.fneReference}</span>{doc.fneCertifiedAt ? ` · le ${fmtDate(doc.fneCertifiedAt)}` : ""}</p>
              {doc.fneVerifyUrl && <a href={doc.fneVerifyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">Vérifier sur la plateforme de la DGI <ExternalLink className="size-3.5" /></a>}
            </>
          ) : s === "PENDING" ? (
            <p className="font-medium">Certification FNE en cours… actualisez la page dans quelques instants.</p>
          ) : s === "FAILED" ? (
            <>
              <p className="font-medium text-destructive">Non certifié{kind === "invoice" ? "e" : ""} FNE</p>
              <p role="alert" className="text-muted-foreground">{doc.fneError}</p>
            </>
          ) : s === "UNKNOWN" ? (
            <>
              <p className="font-medium text-warning">Certification FNE incertaine</p>
              <p role="alert" className="text-muted-foreground">{doc.fneError}</p>
            </>
          ) : (
            <>
              <p className="font-medium">Pas encore certifié{kind === "invoice" ? "e" : ""} FNE</p>
              <p className="text-muted-foreground">La DGI exige la certification de chaque {kind === "invoice" ? "facture" : "avoir"} émis{kind === "invoice" ? "e" : ""}.</p>
            </>
          )}
        </div>
        {s !== "CERTIFIED" && s !== "PENDING" && action(s === "FAILED" || s === "UNKNOWN", s === "UNKNOWN")}
      </CardContent>
    </Card>
  );
}
