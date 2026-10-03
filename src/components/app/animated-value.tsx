"use client";

import { useEffect, useState } from "react";

const NUM = /\d[\d\s\u00a0\u202f]*(?:[.,]\d+)?/;

/**
 * Affiche une valeur déjà formatée (« 37 200 000 FCFA », « 28 % ») en animant son premier nombre de 0 à sa valeur.
 * Le texte final est TOUJOURS la chaîne d'origine (aucune reformulation) ; l'animation est purement décorative
 * et désactivée si l'utilisateur demande moins de mouvement.
 */
export function AnimatedValue({ value, duration = 900 }: { value: string; duration?: number }) {
  const [frame, setFrame] = useState<{ of: string; text: string }>({ of: value, text: value });

  useEffect(() => {
    const m = NUM.exec(value);
    if (!m || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const raw = m[0];
    const target = Number(raw.replace(/[\s\u00a0\u202f]/g, "").replace(",", "."));
    if (!Number.isFinite(target) || target === 0) return;
    const decimals = /[.,](\d+)$/.exec(raw)?.[1]?.length ?? 0;
    const fmt = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const start = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      setFrame({ of: value, text: t >= 1 ? value : value.replace(raw, fmt(target * eased)) });
      if (t < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [value, duration]);

  // une valeur qui change entre deux rendus s'affiche tout de suite telle quelle, sans attendre l'animation
  return <>{frame.of === value ? frame.text : value}</>;
}
