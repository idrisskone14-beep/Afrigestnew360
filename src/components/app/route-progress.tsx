"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Fine barre tissée (ocre / terracotta) en haut de l'écran pendant un changement de page : le clic sur un lien interne la
 * lance, l'arrivée sur la nouvelle page la termine. Purement visuelle ; aucune donnée n'est lue ni envoyée.
 */
export function RouteProgress() {
  const pathname = usePathname();
  // chemin de départ du dernier clic ; tant que la page affichée est la même, la navigation est « en cours »
  const [from, setFrom] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      setFrom(location.pathname);
      clearTimeout(timer);
      timer = setTimeout(() => setFrom(null), 12000); // sécurité : une navigation refusée ne laisse pas la barre bloquée
    };
    document.addEventListener("click", onClick, true); // phase de capture : le composant Link de Next bloque l'action par défaut
    return () => { document.removeEventListener("click", onClick, true); clearTimeout(timer); };
  }, []);

  const state = from === null ? "idle" : from === pathname ? "loading" : "finishing";
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]">
      <div key={state === "loading" ? `l-${from}` : state} data-state={state} className="route-bar h-full w-0 opacity-0" />
    </div>
  );
}
