/**
 * Informations de l'éditeur du service affichées dans les pages légales (mentions légales, conditions d'utilisation, confidentialité).
 * Elles viennent de variables d'environnement `LEGAL_*` (voir .env.example) : une valeur absente s'affiche « [à compléter] »
 * dans les pages, ce qui rend l'oubli visible, et `/api/health` l'indique en avertissement.
 *
 * Les textes des pages sont des MODÈLES : à faire valider par un juriste avant publication (droit applicable, autorité de
 * protection des données, durées de conservation, conditions commerciales).
 */
export const TO_COMPLETE = "[à compléter]";

type Env = Record<string, string | undefined>;

export interface LegalInfo {
  /** Dénomination sociale de l'éditeur. */
  company: string;
  /** Forme juridique et capital, ex. « SARL au capital de 1 000 000 FCFA ». */
  form: string;
  address: string;
  /** RCCM, identifiant fiscal… */
  registration: string;
  /** Directeur de la publication. */
  publisher: string;
  email: string;
  phone: string;
  /** Hébergeur de l'application et de la base de données. */
  host: string;
  /** Pays dont le droit s'applique et dont les tribunaux sont compétents. */
  country: string;
  /** Autorité de protection des données de ce pays. */
  authority: string;
}

const FIELDS: [keyof LegalInfo, string][] = [
  ["company", "LEGAL_COMPANY"], ["form", "LEGAL_FORM"], ["address", "LEGAL_ADDRESS"], ["registration", "LEGAL_REGISTRATION"], ["publisher", "LEGAL_PUBLISHER"],
  ["email", "LEGAL_EMAIL"], ["phone", "LEGAL_PHONE"], ["host", "LEGAL_HOST"], ["country", "LEGAL_COUNTRY"], ["authority", "LEGAL_AUTHORITY"],
];

export function legalInfo(env: Env = process.env): LegalInfo {
  return Object.fromEntries(FIELDS.map(([k, name]) => [k, env[name]?.trim() || TO_COMPLETE])) as unknown as LegalInfo;
}

/** Variables `LEGAL_*` encore absentes. Le téléphone est facultatif. */
export function missingLegal(env: Env = process.env): string[] {
  return FIELDS.map(([, name]) => name).filter((name) => name !== "LEGAL_PHONE" && !env[name]?.trim());
}

/** Date de dernière mise à jour des trois documents (à changer à chaque modification de leur contenu). */
export const LEGAL_UPDATED = "26 octobre 2026";

export const LEGAL_PAGES = [
  { href: "/conditions-utilisation", label: "Conditions d'utilisation" },
  { href: "/confidentialite", label: "Politique de confidentialité" },
  { href: "/mentions-legales", label: "Mentions légales" },
] as const;
