import type { Metadata } from "next";
import { Download } from "lucide-react";
import { StatusBadge } from "@/components/app/status-badge";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { AppError } from "@/core/errors";
import { enforceRateLimit } from "@/core/security/rate-limit";
import { isShareToken } from "@/core/share/service";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { loadSharedDocument } from "@/modules/sales/public-share";
import { DocumentPreview } from "@/modules/sales/ui/document-preview";
import { RespondPanel } from "./respond-panel";

export const metadata: Metadata = { title: "Document", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="rounded-xl border bg-card p-6">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{children}</p>
      </div>
    </main>
  );
}

/** Lien public d'un devis ou d'une facture : lecture, PDF et, pour un devis, réponse du client. Aucun compte requis. */
export default async function SharedDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isShareToken(token)) return <Notice title="Lien invalide">Ce lien n&apos;est pas valide. Vérifiez l&apos;adresse reçue par e-mail.</Notice>;
  try {
    await enforceRateLimit("share-view", { limit: 120, windowMs: 10 * 60_000 });
  } catch (e) {
    if (e instanceof AppError) return <Notice title="Trop de consultations">Merci de réessayer dans quelques minutes.</Notice>;
    throw e;
  }
  const doc = await loadSharedDocument(token);
  if (!doc) return <Notice title="Document introuvable">Ce lien a été désactivé ou n&apos;existe plus. Contactez l&apos;entreprise qui vous l&apos;a envoyé.</Notice>;

  return (
    <main className="mx-auto w-full max-w-[920px] space-y-5 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{doc.company}</p>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">{doc.title} {doc.number}<StatusBadge tone={doc.status.tone}>{doc.status.label}</StatusBadge></h1>
        </div>
        <Button variant="outline" asChild><a href={`/api/p/${token}/pdf?download=1`}><Download className="size-4" /> Télécharger le PDF</a></Button>
      </header>

      {doc.balance !== null && doc.balance > 0 && <p className="rounded-lg border bg-card px-4 py-3 text-sm">Reste à régler : <strong>{formatMoney(doc.balance, doc.preview.currency)}</strong>. Les modalités de paiement figurent sur la facture.</p>}
      {doc.kind === "QUOTE" && doc.canRespond && <RespondPanel token={token} number={doc.number} />}
      {doc.response && (
        <p role="status" className="rounded-lg border bg-card px-4 py-3 text-sm">
          {doc.response.accepted ? "Devis accepté" : "Devis refusé"}{doc.response.by ? ` par ${doc.response.by}` : ""}{doc.response.at ? ` le ${fmtDate(doc.response.at)}` : ""}.{doc.response.note ? ` « ${doc.response.note} »` : ""}
        </p>
      )}

      <section aria-label="Document" className="rounded-xl bg-muted/70 p-3 sm:p-6"><DocumentPreview data={doc.preview} /></section>
      <footer className="flex items-center justify-center gap-2 pb-4 text-xs text-muted-foreground">Document partagé via <Logo compact className="[&_svg]:size-5" /> AfriGest 360</footer>
    </main>
  );
}
