/**
 * Message à afficher quand des champs obligatoires manquent, ou `null` si tout est renseigné.
 * Les formulaires gardent leur bouton d'envoi ACTIF et affichent ce message : un bouton grisé sans explication
 * donne l'impression qu'il ne marche pas (typiquement quand une liste obligatoire est vide).
 */
export function missingFields(checks: ReadonlyArray<readonly [valid: boolean, label: string]>): string | null {
  const missing = checks.filter(([valid]) => !valid).map(([, label]) => label);
  return missing.length === 0 ? null : `Renseignez les champs obligatoires : ${missing.join(", ")}.`;
}
