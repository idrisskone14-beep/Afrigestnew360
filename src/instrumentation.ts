/** Au démarrage du serveur : signale clairement dans les journaux une configuration incomplète (aucune valeur n'est affichée). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkEnv } = await import("@/core/env");
  for (const p of checkEnv()) console[p.level === "blocking" ? "error" : "warn"](`[config] ${p.message}`);
}
