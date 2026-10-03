/** Libellé + valeur d'une fiche (détail d'un élément). */
export function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="text-sm font-medium">{children}</p></div>;
}
