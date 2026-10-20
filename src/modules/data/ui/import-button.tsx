import Link from "next/link";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TenantContext } from "@/core/tenant/context";
import { ENTITIES, canImport, type ImportEntity } from "../entities";

/**
 * Bouton « Importer » d'une liste : ouvre l'assistant d'import déjà positionné sur ce type de données.
 * Affiché seulement à qui peut importer (droit d'import, module actif et droit de création des éléments concernés).
 */
export function ImportButton({ ctx, entity }: { ctx: Pick<TenantContext, "can" | "hasModule">; entity: ImportEntity }) {
  if (!canImport(ctx, ENTITIES[entity])) return null;
  return (
    <Button asChild variant="outline">
      <Link href={`/app/parametres/donnees?entite=${entity}#import`}><Upload className="size-4" /> Importer</Link>
    </Button>
  );
}
