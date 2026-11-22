import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Liens d'export Excel / PDF d'un registre : mêmes filtres que l'écran (paramètres d'adresse recopiés) ; droits revérifiés par la route. */
export function ExportLinks({ kind, params }: { kind: string; params?: Record<string, string | undefined> }) {
  const link = (format: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v) q.set(k, v);
    q.set("format", format);
    return `/api/export/${kind}?${q}`;
  };
  return (
    <>
      <Button asChild variant="outline" className="h-10 bg-card"><a href={link("xlsx")}><Download className="size-4" /> Excel</a></Button>
      <Button asChild variant="outline" className="h-10 bg-card"><a href={link("pdf")}><Download className="size-4" /> PDF</a></Button>
    </>
  );
}
