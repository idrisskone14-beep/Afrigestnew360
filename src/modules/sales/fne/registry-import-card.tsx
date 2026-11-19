"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormAlert } from "@/components/app/form-kit";
import { IMPORT_MAX_MB } from "@/lib/upload-limits";
import { importFneRegistryAction } from "./registry-actions";
import type { FneImportResult } from "./registry";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("fr-FR")} ${n > 1 ? many : one}`;

/** Import de l'export des factures de l'espace FNE (Excel). Ré-importable : seuls les documents nouveaux sont ajoutés. */
export function FneRegistryImportCard({ hasData }: { hasData: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FneImportResult | null>(null);
  const [pending, start] = useTransition();

  const submit = () => start(async () => {
    setError(null); setResult(null);
    if (!file) return setError("Choisissez le fichier Excel exporté depuis l'espace FNE.");
    const fd = new FormData();
    fd.set("file", file);
    const res = await importFneRegistryAction(fd);
    if (!res.ok) return setError(res.error.message);
    setResult(res.data);
    setFile(null);
    if (input.current) input.current.value = "";
    const added = res.data.added.invoices + res.data.added.refunds + res.data.added.proformas;
    toast.success(added > 0 ? `${plural(added, "document ajouté", "documents ajoutés")} au registre` : "Rien de nouveau : tout était déjà dans le registre");
    router.refresh();
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><FileSpreadsheet className="size-5 text-brand" aria-hidden="true" /> {hasData ? "Mettre à jour le registre" : "Importer vos factures FNE"}</CardTitle>
        <CardDescription>
          Dans votre espace FNE, exportez la liste de vos factures (fichier Excel), puis chargez-la ici. Vous pouvez recommencer à tout moment avec un export plus récent : les documents déjà connus (même numéro FNE) ne sont pas comptés deux fois.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <FormAlert message={error} />
        <div className="flex flex-wrap items-center gap-3">
          <Input ref={input} type="file" accept=".xlsx" className="max-w-sm" aria-label="Export des factures FNE" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }} />
          <Button onClick={submit} disabled={pending || !file}><Upload className="size-4" aria-hidden="true" /> {pending ? "Import en cours…" : "Importer"}</Button>
        </div>
        <p className="text-xs text-muted-foreground">Fichier .xlsx, {IMPORT_MAX_MB} Mo au plus. L&apos;import seul ne modifie ni votre comptabilité, ni vos créances, ni votre stock : il alimente le suivi du chiffre d&apos;affaires. Les factures ne sont créées dans Ventes qu&apos;à l&apos;étape « Intégrer aux ventes », plus bas.</p>
        {result && (
          <div role="status" className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4 text-success" aria-hidden="true" /> {plural(result.total, "ligne lue", "lignes lues")}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li><span className="text-foreground">{plural(result.added.invoices, "facture ajoutée", "factures ajoutées")}</span>, {plural(result.added.refunds, "avoir", "avoirs")}, {plural(result.added.proformas, "proforma", "proformas")}</li>
              {result.alreadyKnown > 0 && <li>{plural(result.alreadyKnown, "document déjà connu ignoré", "documents déjà connus ignorés")}</li>}
              {result.duplicatesInFile > 0 && <li>{plural(result.duplicatesInFile, "doublon dans le fichier ignoré", "doublons dans le fichier ignorés")}</li>}
              {result.withoutNumber > 0 && <li className="text-warning">{plural(result.withoutNumber, "avoir exporté sans numéro FNE : compté, à vérifier dans votre espace FNE", "avoirs exportés sans numéro FNE : comptés, à vérifier dans votre espace FNE")}</li>}
              {result.skipped > 0 && <li>{plural(result.skipped, "ligne ignorée (pas du chiffre d'affaires)", "lignes ignorées (pas du chiffre d'affaires)")}</li>}
              {result.invalidCount > 0 && <li className="text-destructive">{plural(result.invalidCount, "ligne illisible", "lignes illisibles")} : {result.invalid.map((i) => `ligne ${i.line} (${i.reason})`).join(", ")}{result.invalidCount > result.invalid.length ? "…" : ""}</li>}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
