import { displayCell, type ExportTable } from "@/core/export/table";
import { cn } from "@/lib/utils";

/** Tableau de rapport (mêmes valeurs et mêmes formats que les exports) ; défilement horizontal sur mobile, impression propre. */
export function ReportTable({ table }: { table: ExportTable }) {
  const right = (t?: string) => t === "money" || t === "number" || t === "percent";
  return (
    <div className="overflow-x-auto rounded-xl border bg-card print:overflow-visible print:border-0">
      <table className="w-full text-sm">
        <caption className="sr-only">{table.title}</caption>
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>{table.columns.map((c) => <th key={c.key} scope="col" className={cn("whitespace-nowrap px-3 py-2 font-medium", right(c.type) ? "text-right" : "text-left")}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.length === 0 && <tr><td colSpan={table.columns.length} className="px-3 py-8 text-center text-muted-foreground">Aucune donnée pour ces filtres.</td></tr>}
          {table.rows.map((r, i) => (
            <tr key={i} className="border-t">
              {table.columns.map((c) => <td key={c.key} className={cn("px-3 py-1.5", right(c.type) ? "tabular text-right" : "text-left", c.key === table.columns[0]!.key && "whitespace-pre font-medium")}>{displayCell(r[c.key], c, table.currency)}</td>)}
            </tr>
          ))}
        </tbody>
        {table.totals && (
          <tfoot>
            <tr className="border-t-2 bg-muted/30 font-semibold">
              {table.columns.map((c, i) => <td key={c.key} className={cn("px-3 py-2", right(c.type) ? "tabular text-right" : "text-left")}>{i === 0 && table.totals![c.key] === undefined ? "Total" : displayCell(table.totals![c.key], c, table.currency)}</td>)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
