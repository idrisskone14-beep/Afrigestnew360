const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** « 2026-03 » → « mars 26 ». */
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

/** Graduations d'axe compactes : 1 250 000 → « 1,3 M », 48 000 → « 48 k ». */
export const compact = (v: number) =>
  Math.abs(v) >= 1e6 ? `${(v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)} k` : String(v);

/** Variation en % entre deux valeurs ; null quand la base est nulle (pas de pourcentage calculable). */
export const variation = (current: number, previous: number): number | null => (previous > 0 ? Math.round(((current - previous) / previous) * 100) : null);

/** Couleurs de catégories : quatre teintes validées (CVD, contraste) puis le gris neutre « Autres ». */
export const CATEGORY_COLORS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)"] as const;
export const OTHER_COLOR = "var(--viz-other)";
