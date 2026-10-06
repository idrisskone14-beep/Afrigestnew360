import "server-only";
import type { Db } from "@/core/db/client";
import type { TenantContext } from "@/core/tenant/ctx-factory";
import type { WidgetData, WidgetDef } from "./widgets";

export interface LoadedWidget {
  w: WidgetDef;
  data: WidgetData | null;
  error: boolean;
}

/** Charge un widget seul, dans ses propres requêtes isolées : une erreur n'affecte que lui. */
async function loadOne(ctx: TenantContext, w: WidgetDef): Promise<LoadedWidget> {
  try {
    return { w, data: await w.load(ctx), error: false };
  } catch (e) {
    console.error(`[dashboard:${w.key}]`, e);
    return { w, data: null, error: true };
  }
}

/**
 * Charge les widgets du tableau de bord en `groups` (5 par défaut) transactions parallèles.
 *
 * Pourquoi : chaque requête isolée (`ctx.db`) coûte ≈ 4 allers-retours vers la base (BEGIN, contexte RLS, requête, COMMIT).
 * Avec une base distante, 14 widgets × plusieurs requêtes = plusieurs secondes. Regrouper N requêtes dans une même
 * transaction coûte N + 3 allers-retours : le tableau de bord s'affiche 2 à 3 fois plus vite.
 *
 * Garantie conservée : l'échec d'un widget n'empêche pas l'affichage des autres. Une erreur SQL fait avorter la
 * transaction PostgreSQL en cours ; les widgets restants du groupe sont alors rechargés individuellement (requêtes isolées).
 */
export async function loadWidgets(ctx: TenantContext, widgets: WidgetDef[], groups = 5): Promise<LoadedWidget[]> {
  const done = new Map<string, LoadedWidget>();
  const n = Math.max(1, Math.min(groups, widgets.length));
  const parts: WidgetDef[][] = Array.from({ length: n }, () => []);
  widgets.forEach((w, i) => parts[i % n]!.push(w));

  await Promise.all(
    parts.map(async (part) => {
      try {
        await ctx.tx(async (tx: Db) => {
          // contexte « dans la transaction » : db et tx pointent sur la même transaction (les widgets en SQL brut y restent)
          const inTx: TenantContext = { ...ctx, db: tx, tx: <T,>(fn: (t: Db) => Promise<T>) => fn(tx) };
          for (const w of part) {
            try {
              done.set(w.key, { w, data: await w.load(inTx), error: false });
            } catch (e) {
              console.error(`[dashboard:${w.key}] (lot) rechargement individuel`, e);
              break; // la transaction est peut-être avortée : la suite est rechargée à part
            }
          }
        });
      } catch (e) {
        console.error("[dashboard] transaction de lot en échec", e);
      }
      for (const w of part) if (!done.has(w.key)) done.set(w.key, await loadOne(ctx, w));
    }),
  );
  return widgets.map((w) => done.get(w.key)!);
}
