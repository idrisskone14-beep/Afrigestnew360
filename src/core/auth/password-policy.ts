import { z } from "zod";

/** Politique de mot de passe, partagée client/serveur (aucune dépendance serveur ici). */
export const passwordSchema = z
  .string()
  .min(10, "10 caractères minimum")
  .max(128, "128 caractères maximum")
  .regex(/[a-z]/, "Au moins une minuscule")
  .regex(/[A-Z]/, "Au moins une majuscule")
  .regex(/\d/, "Au moins un chiffre");
