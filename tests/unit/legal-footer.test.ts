import { describe, expect, it } from "vitest";
import { expandLegalForm, legalFooterLine, type LegalFooterCompany } from "@/core/pdf/legal-footer";
import { taxIdLabel } from "@/lib/reference-data";

const company: LegalFooterCompany = {
  legalName: "ETS GLOBAL TRANSPORT", legalForm: "SARL", shareCapital: "20000000.00", currency: "XOF", country: "CI",
  rccm: null, taxId: "1507399G", address: "Yopougon, Cité Bel Air Route N'Dotré", city: null, documentFooter: null,
};
// formatMoney sépare les milliers par des espaces insécables : on compare sur des espaces ordinaires
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("pied de page des documents", () => {
  it("compose les mentions légales : raison sociale, forme et capital, identifiant fiscal, adresse", () => {
    expect(plain(legalFooterLine(company))).toBe("ETS GLOBAL TRANSPORT - Société à Responsabilité Limitée (SARL) au capital de 20 000 000 FCFA - NCC: 1507399G - Adresse: Yopougon, Cité Bel Air Route N'Dotré");
  });

  it("omet les mentions absentes et n'invente rien", () => {
    expect(legalFooterLine({ ...company, legalForm: null, shareCapital: null, taxId: null, address: null })).toBe("ETS GLOBAL TRANSPORT");
    expect(plain(legalFooterLine({ ...company, legalForm: null }))).toContain("Capital : 20 000 000 FCFA");
    expect(legalFooterLine({ ...company, shareCapital: 0, rccm: "CI-ABJ-2021-B-12345" })).toBe("ETS GLOBAL TRANSPORT - Société à Responsabilité Limitée (SARL) - RCCM: CI-ABJ-2021-B-12345 - NCC: 1507399G - Adresse: Yopougon, Cité Bel Air Route N'Dotré");
  });

  it("ajoute la ville sauf si l'adresse la contient déjà", () => {
    expect(legalFooterLine({ ...company, address: "Rue 12", city: "Abidjan" })).toContain("Adresse: Rue 12, Abidjan");
    expect(legalFooterLine({ ...company, address: "Cité Bel Air, Abidjan", city: "abidjan" })).toContain("Adresse: Cité Bel Air, Abidjan");
  });

  it("le texte personnalisé remplace la ligne automatique", () => {
    expect(legalFooterLine({ ...company, documentFooter: "  SARL au capital de 1 000 000 FCFA — Banque : BICICI 000123  " })).toBe("SARL au capital de 1 000 000 FCFA — Banque : BICICI 000123");
    expect(legalFooterLine({ ...company, documentFooter: "   " })).toContain("ETS GLOBAL TRANSPORT - ");
  });

  it("écrit la forme juridique en toutes lettres quand elle est connue, sinon la garde telle quelle", () => {
    expect(expandLegalForm("S.A.R.L.")).toBe("Société à Responsabilité Limitée (SARL)");
    expect(expandLegalForm("sa")).toBe("Société Anonyme (SA)");
    expect(expandLegalForm("Association loi 1901")).toBe("Association loi 1901");
  });

  it("le sigle de l'identifiant fiscal dépend du pays", () => {
    expect(taxIdLabel("CI")).toBe("NCC");
    expect(taxIdLabel("SN")).toBe("NINEA");
    expect(taxIdLabel("MA")).toBe("ID fiscal");
  });
});
