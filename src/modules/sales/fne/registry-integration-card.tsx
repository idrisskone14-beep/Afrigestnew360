"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormAlert } from "@/components/app/form-kit";
import { integrateFneRegistryAction } from "./registry-actions";
import type { FneIntegrationResult } from "./integrate";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("fr-FR")} ${n > 1 ? many : one}`;

/** Crée dans Ventes les clients, factures et avoirs du registre FNE. Demande confirmation : l'opération ajoute des centaines de documents. */
export function FneIntegrationCard({ invoices, refunds }: { invoices: number; refunds: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FneIntegrationResult | null>(null);
  const [pending, start] = useTransition();

  const run = () => start(async () => {
    setError(null);
    const res = await integrateFneRegistryAction({});
    if (!res.ok) { setError(res.error.message); setOpen(false); return; }
    setOpen(false);
    setResult(res.data);
    toast.success("Registre FNE intégré aux ventes");
    router.refresh();
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Link2 className="size-5 text-brand" aria-hidden="true" /> Intégrer aux ventes</CardTitle>
        <CardDescription>
          {invoices + refunds > 0
            ? <>{plural(invoices, "facture", "factures")} et {plural(refunds, "avoir", "avoirs")} du registre ne sont pas encore dans Ventes. En les intégrant, ils apparaissent dans Factures de vente et Avoirs, avec leurs clients.</>
            : "Tout le registre est déjà intégré aux ventes."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <FormAlert message={error} />
        {invoices + refunds > 0 && <div><Button onClick={() => setOpen(true)} disabled={pending}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" aria-hidden="true" />} Intégrer aux ventes</Button></div>}
        {result && (
          <div role="status" className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4 text-success" aria-hidden="true" /> Intégration terminée</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li><span className="text-foreground">{plural(result.invoicesCreated, "facture créée", "factures créées")}</span>, {plural(result.creditNotesCreated, "avoir créé", "avoirs créés")}</li>
              <li>{plural(result.customersCreated, "client créé", "clients créés")}, {plural(result.customersMatched, "client retrouvé", "clients retrouvés")} (par NCC ou par nom)</li>
              {(result.invoicesLinked > 0 || result.creditNotesLinked > 0) && <li>{plural(result.invoicesLinked + result.creditNotesLinked, "document déjà présent dans Ventes : rattaché, pas recréé", "documents déjà présents dans Ventes : rattachés, pas recréés")}</li>}
              {result.refundsWithoutInvoice > 0 && <li className="text-warning">{plural(result.refundsWithoutInvoice, "avoir laissé de côté", "avoirs laissés de côté")} : la facture d&apos;origine n&apos;est ni dans le registre ni dans Ventes (importez un export plus ancien, puis recommencez)</li>}
              {result.amountsToCheck > 0 && <li className="text-warning">{plural(result.amountsToCheck, "document dont HT + TVA ne retombe pas sur le TTC", "documents dont HT + TVA ne retombe pas sur le TTC")} : à vérifier dans votre espace FNE</li>}
            </ul>
            <p className="mt-3 flex flex-wrap gap-3">
              <Link href="/app/sales/factures" className="text-brand hover:underline">Voir les factures de vente</Link>
              <Link href="/app/sales/avoirs" className="text-brand hover:underline">Voir les avoirs</Link>
            </p>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Intégrer {plural(invoices, "facture", "factures")} et {plural(refunds, "avoir", "avoirs")} aux ventes ?</DialogTitle>
            <DialogDescription>Voici exactement ce qui va se passer.</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            <li>Les <strong>clients</strong> manquants sont créés (ceux déjà connus, par NCC ou par nom, sont réutilisés).</li>
            <li>Chaque facture et chaque avoir est créé avec <strong>son numéro FNE</strong> et <strong>une seule ligne</strong> : l&apos;export ne contient pas le détail des articles.</li>
            <li>Les factures sont <strong>à encaisser</strong>, sans date d&apos;échéance : vous enregistrez vous-même les paiements, comme d&apos;habitude.</li>
            <li><strong>Aucune écriture comptable</strong>, aucun mouvement de stock, et rien n&apos;est renvoyé à la DGI.</li>
            <li>Vous pouvez relancer sans risque : un document déjà présent n&apos;est jamais créé deux fois.</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={run} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />} Intégrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
