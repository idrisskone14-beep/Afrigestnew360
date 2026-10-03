import type { Metadata } from "next";
import { Download } from "lucide-react";
import { forbidden } from "next/navigation";
import { ActionButton } from "@/components/app/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireTenantContext } from "@/core/tenant/guards";
import { fmtDateTime } from "@/lib/format";
import { discardImportAction } from "@/modules/data/actions";
import { ENTITIES, IMPORT_ENTITIES, canImport } from "@/modules/data/entities";
import { EXPORTERS } from "@/modules/data/exports";
import { listImports } from "@/modules/data/import-service";
import { ImportWizard } from "@/modules/data/ui/import-wizard";

export const metadata: Metadata = { title: "Paramètres — Import / export" };

const EXPORT_LIST = [
  { kind: "clients", label: "Clients" }, { kind: "fournisseurs", label: "Fournisseurs" }, { kind: "produits", label: "Produits et services" },
  { kind: "stock", label: "État des stocks" }, { kind: "salaries", label: "Salariés" }, { kind: "vehicules", label: "Véhicules" }, { kind: "contraventions", label: "Contraventions" },
] as const;
const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  UPLOADED: { label: "Fichier chargé", variant: "outline" }, VALIDATED: { label: "Vérifié, non importé", variant: "outline" }, RUNNING: { label: "En cours", variant: "secondary" }, DONE: { label: "Terminé", variant: "default" }, FAILED: { label: "Échec", variant: "destructive" },
};

export default async function DataPage() {
  const ctx = await requireTenantContext();
  const exports = EXPORT_LIST.filter((e) => { const x = EXPORTERS[e.kind]!; return (!x.module || ctx.hasModule(x.module)) && x.permissions.every((p) => ctx.can(p)); });
  const imports = IMPORT_ENTITIES.map((k) => ENTITIES[k]).filter((e) => canImport(ctx, e));
  if (exports.length === 0 && !ctx.can("data.import.manage")) forbidden();
  const history = ctx.can("data.import.manage") ? await listImports(ctx) : [];

  return (
    <div className="max-w-4xl space-y-10">
      <section aria-labelledby="exp-title" className="space-y-3">
        <div>
          <h2 id="exp-title" className="text-base font-semibold">Exporter vos données</h2>
          <p className="text-sm text-muted-foreground">Listes complètes au format Excel, CSV ou PDF, selon vos droits. Les rapports (ventes, dépenses, trésorerie…) s&apos;exportent depuis le module Rapports.</p>
        </div>
        {exports.length === 0 ? <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">Aucun export disponible : l&apos;export de données exige le droit « Exports de données » et la lecture des données concernées.</p> : (
          <Card className="divide-y p-0">
            {exports.map((e) => (
              <div key={e.kind} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex-1 text-sm font-medium">{e.label}</span>
                {(["xlsx", "csv", "pdf"] as const).map((f) => <Button key={f} asChild variant="outline" size="sm"><a href={`/api/export/${e.kind}?format=${f}`}><Download className="size-4" /> {f === "xlsx" ? "Excel" : f.toUpperCase()}</a></Button>)}
              </div>
            ))}
          </Card>
        )}
      </section>

      <section aria-labelledby="imp-title" className="space-y-3">
        <div>
          <h2 id="imp-title" className="text-base font-semibold">Importer des données</h2>
          <p className="text-sm text-muted-foreground">Clients, fournisseurs, salariés, produits et quantités en stock depuis un fichier CSV ou Excel : correspondance des colonnes, vérification ligne par ligne, puis import avec rapport d&apos;erreurs. Les lignes déjà présentes sont ignorées, jamais dupliquées.</p>
        </div>
        {imports.length === 0 ? <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">Vous n&apos;avez pas le droit d&apos;importer des données (« Imports de données » et droit de création des éléments concernés).</p> : <ImportWizard entities={imports.map((e) => ({ key: e.key, label: e.label }))} />}
      </section>

      {history.length > 0 && (
        <section aria-labelledby="hist-title" className="space-y-3">
          <h2 id="hist-title" className="text-base font-semibold">Historique des imports</h2>
          <Card className="divide-y p-0">
            {history.map((j) => (
              <div key={j.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{ENTITIES[j.entity as keyof typeof ENTITIES]?.label ?? j.entity} — {j.fileName}</p>
                  <p className="text-xs text-muted-foreground">{fmtDateTime(j.createdAt)} · {j.rowCount} ligne{j.rowCount > 1 ? "s" : ""}{j.status === "DONE" ? ` · ${j.createdCount} créée${j.createdCount > 1 ? "s" : ""}, ${j.ignoredCount} ignorée${j.ignoredCount > 1 ? "s" : ""}, ${j.errorCount + j.failedCount} en erreur` : ""}</p>
                </div>
                <Badge variant={STATUS[j.status]?.variant ?? "outline"}>{STATUS[j.status]?.label ?? j.status}</Badge>
                {j.status === "DONE" && j.errorCount + j.failedCount + j.ignoredCount > 0 && <Button asChild variant="outline" size="sm"><a href={`/api/export/import-rapport?job=${j.id}&format=xlsx`}><Download className="size-4" /> Rapport</a></Button>}
                {j.status !== "RUNNING" && <ActionButton action={discardImportAction} input={{ id: j.id }} variant="ghost" size="sm" label="Supprimer" success="Import supprimé" confirm={{ title: "Supprimer cet import de l'historique ?", description: "Les données déjà importées ne sont pas affectées.", confirmLabel: "Supprimer" }} />}
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}
