import Link from "next/link";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { PageSizeSelect } from "./page-size-select";
import { cn } from "@/lib/utils";
import { PAGE_SIZE, PAGE_SIZES, buildQuery, pageSizeOf, type SearchParams } from "@/lib/list-params";

function Step({ href, disabled, label, children }: { href: string; disabled: boolean; label: string; children: React.ReactNode }) {
  const cls = "grid size-8 place-items-center rounded-md border bg-card transition-colors";
  return disabled
    ? <span aria-disabled="true" aria-label={label} className={cn(cls, "cursor-not-allowed text-muted-foreground/40")}>{children}</span>
    : <Link href={href} aria-label={label} className={cn(cls, "text-foreground hover:bg-muted")}>{children}</Link>;
}

/**
 * Pied de liste : « Page X sur N », choix du nombre de lignes et boutons première / précédente / suivante / dernière.
 * Avec la taille de page par défaut, le nombre de lignes choisi dans l'URL (`lignes`) s'applique ; une liste qui impose sa
 * propre taille la garde.
 */
export function Pagination({ total, page, pageSize, basePath, searchParams }: {
  total: number; page: number; pageSize: number; basePath: string; searchParams: SearchParams;
}) {
  const size = pageSize === PAGE_SIZE ? pageSizeOf(searchParams) : pageSize;
  const selectable = pageSize === PAGE_SIZE && total > PAGE_SIZES[0];
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pages);
  if (total === 0) return null;
  const href = (p: number) => `${basePath}${buildQuery(searchParams, { page: p > 1 ? p : undefined })}`;
  return (
    <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1 text-sm text-muted-foreground">
      <span>{pages > 1 ? <>Page {current} sur {pages}</> : <>{total} résultat{total > 1 ? "s" : ""}</>}</span>
      <div className="flex items-center gap-4">
        {selectable && <PageSizeSelect value={size} />}
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <Step href={href(1)} disabled={current <= 1} label="Première page"><ChevronsLeft className="size-4" /></Step>
            <Step href={href(current - 1)} disabled={current <= 1} label="Page précédente"><ChevronLeft className="size-4" /></Step>
            <Step href={href(current + 1)} disabled={current >= pages} label="Page suivante"><ChevronRight className="size-4" /></Step>
            <Step href={href(pages)} disabled={current >= pages} label="Dernière page"><ChevronsRight className="size-4" /></Step>
          </div>
        )}
      </div>
    </nav>
  );
}
