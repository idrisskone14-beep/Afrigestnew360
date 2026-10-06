"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

export interface NavCounts {
  /** Notifications non lues. */
  unread: number;
  /** Demandes en attente de la décision de l'utilisateur. */
  pending: number;
}

const NavCountsContext = createContext<NavCounts>({ unread: 0, pending: 0 });
export const useNavCounts = () => useContext(NavCountsContext);

const REFRESH_MS = 60_000;

/**
 * Compteurs de la barre latérale, chargés APRÈS l'affichage de la page : leur calcul coûte des allers-retours vers la base
 * qui retardaient chaque page. Rafraîchis à chaque changement de page, au retour sur l'onglet et toutes les minutes
 * (les badges restent donc à jour sans recharger).
 */
export function NavCountsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [counts, setCounts] = useState<NavCounts>({ unread: 0, pending: 0 });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/nav/counts", { cache: "no-store", credentials: "same-origin" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as Partial<NavCounts>;
        if (!cancelled) setCounts({ unread: Number(data.unread) || 0, pending: Number(data.pending) || 0 });
      } catch {
        /* réseau indisponible : les badges gardent leur dernière valeur */
      }
    };
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [pathname]);

  const value = useMemo(() => counts, [counts]);
  return <NavCountsContext.Provider value={value}>{children}</NavCountsContext.Provider>;
}
