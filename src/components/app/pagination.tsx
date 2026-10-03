import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildQuery, type SearchParams } from "@/lib/list-params";

export function Pagination({ total, page, pageSize, basePath, searchParams }: {
  total: number; page: number; pageSize: number; basePath: string; searchParams: SearchParams;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) {
    return total > 0 ? <p className="mt-3 text-sm text-muted-foreground">{total} résultat{total > 1 ? "s" : ""}</p> : null;
  }
  const href = (p: number) => `${basePath}${buildQuery(searchParams, { page: p })}`;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{from}–{to} sur {total}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" asChild disabled={page <= 1}><Link href={href(Math.max(1, page - 1))} aria-disabled={page <= 1}><ChevronLeft className="size-4" /> Précédent</Link></Button>
        <Button variant="outline" size="sm" asChild disabled={page >= pages}><Link href={href(Math.min(pages, page + 1))} aria-disabled={page >= pages}>Suivant <ChevronRight className="size-4" /></Link></Button>
      </div>
    </nav>
  );
}
