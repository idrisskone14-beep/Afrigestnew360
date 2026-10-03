"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, MinusCircle, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert } from "@/components/app/form-kit";
import { discardImportAction, previewImportAction, runImportAction, uploadImportAction } from "../actions";

export interface ImportEntityOption { key: string; label: string }
interface Analysis { id: string; entity: string; headers: string[]; rowCount: number; sample: string[][]; suggested: Record<string, number>; fields: { key: string; label: string; required: boolean }[] }
interface Preview { id: string; valid: number; errors: number; ignored: number; total: number; preview: { line: number; status: "ok" | "error" | "ignored"; messages: string[]; values: Record<string, string> }[]; previewMore: number }
interface Result { created: number; ignored: number; errors: number; failed: number; id: string }

const NONE = "__none";
const MAX_MB = 5;
const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);

export function ImportWizard({ entities }: { entities: ImportEntityOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [entity, setEntity] = useState(entities[0]?.key ?? "");
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const reset = () => { setAnalysis(null); setPreview(null); setResult(null); setFile(null); setMapping({}); setError(null); if (input.current) input.current.value = ""; };

  const upload = () => start(async () => {
    setError(null);
    if (!file) return setError("Choisissez un fichier.");
    const fd = new FormData();
    fd.set("entity", entity); fd.set("file", file);
    const r = await uploadImportAction(fd);
    if (!r.ok) return setError(errText(r.error));
    setAnalysis(r.data); setMapping(r.data.suggested); setPreview(null);
  });

  const check = () => start(async () => {
    if (!analysis) return;
    setError(null);
    const r = await previewImportAction({ id: analysis.id, mapping });
    if (!r.ok) return setError(errText(r.error));
    setPreview(r.data);
  });

  const run = () => start(async () => {
    if (!analysis) return;
    setError(null);
    const r = await runImportAction({ id: analysis.id });
    if (!r.ok) return setError(errText(r.error));
    setResult(r.data); setPreview(null);
    toast.success(`${r.data.created} ligne${r.data.created > 1 ? "s" : ""} importée${r.data.created > 1 ? "s" : ""}`);
    router.refresh();
  });

  const cancel = () => start(async () => {
    if (analysis && !result) await discardImportAction({ id: analysis.id });
    reset(); router.refresh();
  });

  const setCol = (field: string, v: string) => { setPreview(null); setMapping((m) => { const n = { ...m }; if (v === NONE) delete n[field]; else n[field] = Number(v); return n; }); };
  const missing = analysis?.fields.filter((f) => f.required && mapping[f.key] === undefined) ?? [];
  const duplicated = Object.values(mapping).length !== new Set(Object.values(mapping)).size;
  const entityLabel = entities.find((e) => e.key === entity)?.label ?? "";

  // ── Résultat ──
  if (result) {
    const bad = result.errors + result.failed;
    return (
      <Card className="space-y-4 p-5" role="status">
        <div className="flex items-center gap-2 text-base font-semibold"><CheckCircle2 className="size-5 text-emerald-600" /> Import terminé</div>
        <ul className="grid gap-2 text-sm sm:grid-cols-3">
          <li className="rounded-lg border p-3"><span className="text-2xl font-semibold tabular">{result.created}</span><br />créée{result.created > 1 ? "s" : ""}</li>
          <li className="rounded-lg border p-3"><span className="text-2xl font-semibold tabular">{result.ignored}</span><br />ignorée{result.ignored > 1 ? "s" : ""} (déjà présentes)</li>
          <li className="rounded-lg border p-3"><span className="text-2xl font-semibold tabular text-destructive">{bad}</span><br />en erreur</li>
        </ul>
        <div className="flex flex-wrap gap-2">
          {(bad > 0 || result.ignored > 0) && <>
            <Button asChild variant="outline" size="sm"><a href={`/api/export/import-rapport?job=${result.id}&format=xlsx`}><Download className="size-4" /> Rapport d&apos;anomalies (Excel)</a></Button>
            <Button asChild variant="outline" size="sm"><a href={`/api/export/import-rapport?job=${result.id}&format=csv`}><Download className="size-4" /> CSV</a></Button>
          </>}
          <Button size="sm" onClick={reset}>Nouvel import</Button>
        </div>
        {bad > 0 && <p className="text-xs text-muted-foreground">Corrigez les lignes en erreur dans le rapport puis réimportez-les : les lignes déjà créées seront ignorées.</p>}
      </Card>
    );
  }

  // ── Étape 1 : fichier ──
  if (!analysis) {
    return (
      <Card className="space-y-4 p-5">
        <FormAlert message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm">Données à importer
            <Select value={entity} onValueChange={setEntity}>
              <SelectTrigger className="w-full" aria-label="Données à importer"><SelectValue /></SelectTrigger>
              <SelectContent>{entities.map((e) => <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-sm">Fichier (.csv ou .xlsx, {MAX_MB} Mo et 2 000 lignes maximum)
            <Input ref={input} type="file" accept=".csv,.xlsx,.txt" onChange={(e) => { const f = e.target.files?.[0] ?? null; if (f && f.size > MAX_MB * 1024 * 1024) { setError(`Le fichier dépasse ${MAX_MB} Mo.`); setFile(null); } else { setError(null); setFile(f); } }} />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">La première ligne doit contenir les noms des colonnes. Vous associerez ensuite chaque colonne à un champ, puis vérifierez les données avant tout enregistrement.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={pending || !file || !entity} onClick={upload}><Upload className="size-4" /> {pending ? "Analyse…" : "Analyser le fichier"}</Button>
          <Button asChild variant="ghost" size="sm"><a href={`/api/export/modele-${entity}?format=xlsx`}><FileSpreadsheet className="size-4" /> Télécharger le modèle Excel</a></Button>
          <Button asChild variant="ghost" size="sm"><a href={`/api/export/modele-${entity}?format=csv`}>Modèle CSV</a></Button>
        </div>
      </Card>
    );
  }

  // ── Étape 2 : correspondance des colonnes ; étape 3 : vérification ──
  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm"><span className="font-semibold">{entityLabel}</span> — {analysis.rowCount} ligne{analysis.rowCount > 1 ? "s" : ""} détectée{analysis.rowCount > 1 ? "s" : ""}</p>
        <Button variant="ghost" size="sm" disabled={pending} onClick={cancel}>Abandonner</Button>
      </div>
      <FormAlert message={error} />

      <section aria-labelledby="map-title" className="space-y-2">
        <h3 id="map-title" className="text-sm font-semibold">1. Correspondance des colonnes</h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left font-medium">Champ</th><th className="px-3 py-2 text-left font-medium">Colonne du fichier</th><th className="hidden px-3 py-2 text-left font-medium sm:table-cell">Exemple</th></tr></thead>
            <tbody>
              {analysis.fields.map((f) => {
                const col = mapping[f.key];
                return (
                  <tr key={f.key} className="border-t">
                    <td className="px-3 py-1.5">{f.label}{f.required && <span className="text-destructive" aria-label="obligatoire"> *</span>}</td>
                    <td className="px-3 py-1.5">
                      <Select value={col === undefined ? NONE : String(col)} onValueChange={(v) => setCol(f.key, v)}>
                        <SelectTrigger className="h-8 w-56" aria-label={`Colonne pour ${f.label}`}><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value={NONE}>— Ne pas importer —</SelectItem>{analysis.headers.map((h, i) => <SelectItem key={i} value={String(i)}>{h || `Colonne ${i + 1}`}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="hidden max-w-48 truncate px-3 py-1.5 text-xs text-muted-foreground sm:table-cell">{col !== undefined ? analysis.sample.map((r) => r[col]).filter(Boolean).slice(0, 2).join(" · ") : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {missing.length > 0 && <p role="alert" className="text-xs text-destructive">Champ{missing.length > 1 ? "s" : ""} obligatoire{missing.length > 1 ? "s" : ""} sans colonne : {missing.map((f) => f.label).join(", ")}.</p>}
        {duplicated && <p role="alert" className="text-xs text-destructive">Une même colonne ne peut alimenter qu&apos;un seul champ.</p>}
        <Button disabled={pending || missing.length > 0 || duplicated} onClick={check}>{pending && !preview ? "Vérification…" : preview ? "Vérifier à nouveau" : "Vérifier les données"}</Button>
      </section>

      {preview && (
        <section aria-labelledby="prev-title" className="space-y-3">
          <h3 id="prev-title" className="text-sm font-semibold">2. Vérification avant import</h3>
          <div className="flex flex-wrap gap-2 text-sm" role="status">
            <Badge variant="default">{preview.valid} valide{preview.valid > 1 ? "s" : ""}</Badge>
            <Badge variant={preview.errors ? "destructive" : "secondary"}>{preview.errors} en erreur</Badge>
            <Badge variant="secondary">{preview.ignored} déjà présente{preview.ignored > 1 ? "s" : ""} (ignorée{preview.ignored > 1 ? "s" : ""})</Badge>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left font-medium">Ligne</th><th className="px-3 py-2 text-left font-medium">Résultat</th>{analysis.fields.filter((f) => mapping[f.key] !== undefined).slice(0, 4).map((f) => <th key={f.key} className="px-3 py-2 text-left font-medium">{f.label}</th>)}<th className="px-3 py-2 text-left font-medium">Détail</th></tr></thead>
              <tbody>
                {preview.preview.map((r) => (
                  <tr key={r.line} className="border-t align-top">
                    <td className="px-3 py-1.5 tabular">{r.line}</td>
                    <td className="px-3 py-1.5">{r.status === "ok" ? <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-3.5" /> Valide</span> : r.status === "ignored" ? <span className="inline-flex items-center gap-1 text-muted-foreground"><MinusCircle className="size-3.5" /> Ignorée</span> : <span className="inline-flex items-center gap-1 text-destructive"><AlertTriangle className="size-3.5" /> Erreur</span>}</td>
                    {analysis.fields.filter((f) => mapping[f.key] !== undefined).slice(0, 4).map((f) => <td key={f.key} className="max-w-40 truncate px-3 py-1.5">{r.values[f.key]}</td>)}
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.messages.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.previewMore > 0 && <p className="text-xs text-muted-foreground">… et {preview.previewMore} autre{preview.previewMore > 1 ? "s" : ""} ligne{preview.previewMore > 1 ? "s" : ""} (le rapport complet est disponible après l&apos;import).</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={pending || preview.valid === 0} onClick={run}>{pending ? "Import en cours…" : `Importer ${preview.valid} ligne${preview.valid > 1 ? "s" : ""} valide${preview.valid > 1 ? "s" : ""}`}</Button>
            {preview.errors > 0 && <span className="text-xs text-muted-foreground">Les {preview.errors} ligne{preview.errors > 1 ? "s" : ""} en erreur ne seront pas importées ; elles figureront dans le rapport.</span>}
          </div>
        </section>
      )}
    </Card>
  );
}
