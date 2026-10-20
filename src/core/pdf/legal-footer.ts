import { formatMoney, taxIdLabel } from "@/lib/reference-data";

/** Mention de marque imprimée sous les mentions légales de tous les documents. */
export const DOCUMENT_BRAND = "Document généré par AfriGest 360";

/** Formes juridiques courantes, écrites en toutes lettres (« SARL » → « Société à Responsabilité Limitée (SARL) »). */
const LEGAL_FORMS: Record<string, string> = {
  SARL: "Société à Responsabilité Limitée",
  SUARL: "Société Unipersonnelle à Responsabilité Limitée",
  EURL: "Entreprise Unipersonnelle à Responsabilité Limitée",
  SA: "Société Anonyme",
  SAS: "Société par Actions Simplifiée",
  SASU: "Société par Actions Simplifiée Unipersonnelle",
  SNC: "Société en Nom Collectif",
  SCI: "Société Civile Immobilière",
  GIE: "Groupement d'Intérêt Économique",
  EI: "Entreprise Individuelle",
};

export function expandLegalForm(form: string): string {
  const key = form.replace(/[.\s]/g, "").toUpperCase();
  const long = LEGAL_FORMS[key];
  return long ? `${long} (${key})` : form.trim();
}

export interface LegalFooterCompany {
  legalName: string;
  legalForm: string | null;
  shareCapital: number | string | { toString(): string } | null;
  currency: string;
  country: string;
  rccm: string | null;
  taxId: string | null;
  address: string | null;
  city: string | null;
  /** Texte libre : s'il est renseigné, il remplace la ligne composée automatiquement. */
  documentFooter: string | null;
}

/**
 * Ligne de mentions légales du pied de page des documents, ex. :
 * « ETS GLOBAL TRANSPORT - Société à Responsabilité Limitée (SARL) au capital de 20 000 000 FCFA - NCC: 1507399G - Adresse: Yopougon, Cité Bel Air ».
 * Chaque mention absente est simplement omise.
 */
export function legalFooterLine(c: LegalFooterCompany): string {
  const custom = c.documentFooter?.trim();
  if (custom) return custom;

  const capital = c.shareCapital !== null && c.shareCapital !== "" && Number(c.shareCapital) > 0 ? formatMoney(Number(c.shareCapital), c.currency) : "";
  const form = c.legalForm?.trim() ? expandLegalForm(c.legalForm) : "";
  const identity = form ? `${form}${capital ? ` au capital de ${capital}` : ""}` : capital ? `Capital : ${capital}` : "";

  const address = [c.address?.trim(), c.city?.trim()].filter((x): x is string => Boolean(x));
  // la ville n'est pas répétée quand l'adresse la contient déjà
  const where = address.length === 2 && address[0]!.toLowerCase().includes(address[1]!.toLowerCase()) ? address[0]! : address.join(", ");

  return [
    c.legalName,
    identity,
    c.rccm?.trim() ? `RCCM: ${c.rccm.trim()}` : "",
    c.taxId?.trim() ? `${taxIdLabel(c.country)}: ${c.taxId.trim()}` : "",
    where ? `Adresse: ${where}` : "",
  ].filter(Boolean).join(" - ");
}
