/**
 * Interrupteur de la plateforme : tant que la DGI n'a pas autorisé le raccordement, la FNE reste invisible et inactive
 * (aucun onglet, aucune certification, aucun appel). Pour l'ouvrir : FNE_ENABLED=true.
 * Fichier sans dépendance serveur : le menu (importé aussi par des composants client) peut l'appeler sans risque.
 */
export const fneFeatureEnabled = (env: Record<string, string | undefined> = process.env) => env.FNE_ENABLED === "true";
