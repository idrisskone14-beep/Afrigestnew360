import { describe, expect, it } from "vitest";
import { missingFields } from "@/lib/required-fields";

describe("champs obligatoires", () => {
  it("renvoie null quand tout est renseigné", () => {
    expect(missingFields([[true, "Libellé"], [true, "Montant"]])).toBeNull();
    expect(missingFields([])).toBeNull();
  });

  it("nomme chaque champ manquant, dans l'ordre", () => {
    expect(missingFields([[false, "Véhicule"], [true, "Date"], [false, "Chauffeur"]])).toBe("Renseignez les champs obligatoires : Véhicule, Chauffeur.");
    expect(missingFields([[false, "Libellé"]])).toBe("Renseignez les champs obligatoires : Libellé.");
  });
});
