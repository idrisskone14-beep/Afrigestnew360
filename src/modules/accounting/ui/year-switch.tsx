import Link from "next/link";
import { cn } from "@/lib/utils";

/** Sélecteur d'exercice (liens, rendu serveur) : conserve les autres paramètres d'URL. */
export function YearSwitch({ years, current, basePath, params = {} }: { years: { id: string; name: string; status: string }[]; current: string; basePath: string; params?: Record<string, string | undefined> }) {
  const href = (id: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
    p.set("exercice", id);
    return `${basePath}?${p}`;
  };
  return (
    <nav aria-label="Exercice comptable" className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Exercice :</span>
      {years.map((y) => (
        <Link key={y.id} href={href(y.id)} aria-current={y.id === current ? "page" : undefined}
          className={cn("rounded-full border px-3 py-1 text-sm transition-colors", y.id === current ? "border-brand bg-brand/10 font-medium text-brand" : "text-muted-foreground hover:text-foreground")}>
          {y.name}{y.status === "CLOSED" ? " · clos" : ""}
        </Link>
      ))}
    </nav>
  );
}
