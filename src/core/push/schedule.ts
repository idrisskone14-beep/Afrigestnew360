import "server-only";
import { flushPendingPush } from "./service";

/**
 * Programme la distribution des push JUSTE APRÈS la réponse à l'utilisateur (la transaction qui a créé la notification est alors
 * validée). Hors requête (tâche planifiée, script, tests), `after` n'existe pas : la tâche planifiée distribue les push en attente.
 */
export function schedulePushFlush() {
  void (async () => {
    try {
      const { after } = await import("next/server");
      after(() => flushPendingPush().then(() => undefined, (e) => console.error("[push] distribution", e)));
    } catch {
      /* pas de contexte de requête : la tâche planifiée s'en charge */
    }
  })();
}
