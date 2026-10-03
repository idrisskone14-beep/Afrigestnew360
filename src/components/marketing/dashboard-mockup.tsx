/** Illustration du tableau de bord AfriGest 360 (données fictives, purement décoratives). */
const BARS = [38, 52, 44, 61, 55, 72, 66, 84, 78, 92, 88, 100];
const LINE = "M0,70 C30,62 50,66 80,48 C110,30 130,44 160,28 C190,12 220,22 250,8";

export function DashboardMockup() {
  return (
    <div className="relative" role="img" aria-label="Aperçu du tableau de bord AfriGest 360 : chiffre d'affaires, trésorerie, factures à encaisser et activité récente">
      <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-brand/25 via-brand-green/15 to-transparent blur-2xl" />
      <div className="overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-brand/10">
        <div className="flex items-center gap-1.5 border-b bg-muted/50 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-destructive/70" /><span className="size-2.5 rounded-full bg-warning/80" /><span className="size-2.5 rounded-full bg-success/80" />
          <span className="ml-3 text-[11px] text-muted-foreground">app.afrigest360.com / dashboard</span>
        </div>
        <div className="grid grid-cols-[3.2rem_1fr] sm:grid-cols-[9rem_1fr]">
          <aside className="space-y-1.5 border-r bg-sidebar p-2.5 sm:p-3">
            {["Tableau de bord", "Finance", "Ventes", "CRM", "Stock", "RH", "Projets"].map((l, i) => (
              <div key={l} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] ${i === 0 ? "bg-sidebar-accent font-medium text-foreground" : "text-muted-foreground"}`}>
                <span className={`size-2 shrink-0 rounded-sm ${i === 0 ? "bg-brand" : "bg-muted-foreground/40"}`} />
                <span className="hidden sm:inline">{l}</span>
              </div>
            ))}
          </aside>
          <div className="space-y-3 p-3 sm:p-4">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {[
                { l: "Chiffre d'affaires", v: "48,2 M", d: "+12 %", up: true },
                { l: "Dépenses", v: "31,7 M", d: "+4 %", up: false },
                { l: "Trésorerie", v: "17,9 M", d: "+8 %", up: true },
                { l: "À encaisser", v: "9,4 M", d: "6 factures", up: null },
              ].map((k) => (
                <div key={k.l} className="rounded-lg border bg-background p-2.5">
                  <p className="truncate text-[10px] text-muted-foreground">{k.l}</p>
                  <p className="mt-0.5 text-sm font-semibold tabular sm:text-base">{k.v} <span className="text-[10px] font-normal text-muted-foreground">FCFA</span></p>
                  <p className={`text-[10px] ${k.up === true ? "text-success" : k.up === false ? "text-warning" : "text-muted-foreground"}`}>{k.d}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-2.5 sm:grid-cols-[1.5fr_1fr]">
              <div className="rounded-lg border bg-background p-3">
                <p className="text-[11px] font-medium">Évolution du chiffre d'affaires</p>
                <div className="mt-3 flex h-24 items-end gap-1.5">
                  {BARS.map((h, i) => <div key={i} className="flex-1 rounded-t bg-brand/80" style={{ height: `${h}%`, opacity: 0.45 + i / 22 }} />)}
                </div>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <p className="text-[11px] font-medium">Trésorerie</p>
                <svg viewBox="0 0 250 80" className="mt-3 h-24 w-full" preserveAspectRatio="none" aria-hidden="true">
                  <path d={`${LINE} L250,80 L0,80 Z`} fill="var(--brand-green)" opacity="0.15" />
                  <path d={LINE} fill="none" stroke="var(--brand-green)" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              </div>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <p className="text-[11px] font-medium">À traiter aujourd'hui</p>
              <ul className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
                <li className="flex justify-between"><span>3 factures échues à relancer</span><span className="text-warning">Urgent</span></li>
                <li className="flex justify-between"><span>2 demandes d'achat à valider</span><span>À valider</span></li>
                <li className="flex justify-between"><span>5 produits sous le seuil minimum</span><span>Stock</span></li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
