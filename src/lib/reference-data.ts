export interface CountryRef { code: string; name: string; currency: string; timezone: string }

/** Pays prioritaires (marché africain) ; extensible sans migration. */
export const COUNTRIES: readonly CountryRef[] = [
  { code: "CI", name: "Côte d'Ivoire", currency: "XOF", timezone: "Africa/Abidjan" },
  { code: "SN", name: "Sénégal", currency: "XOF", timezone: "Africa/Dakar" },
  { code: "ML", name: "Mali", currency: "XOF", timezone: "Africa/Bamako" },
  { code: "BF", name: "Burkina Faso", currency: "XOF", timezone: "Africa/Ouagadougou" },
  { code: "BJ", name: "Bénin", currency: "XOF", timezone: "Africa/Porto-Novo" },
  { code: "TG", name: "Togo", currency: "XOF", timezone: "Africa/Lome" },
  { code: "NE", name: "Niger", currency: "XOF", timezone: "Africa/Niamey" },
  { code: "GW", name: "Guinée-Bissau", currency: "XOF", timezone: "Africa/Bissau" },
  { code: "CM", name: "Cameroun", currency: "XAF", timezone: "Africa/Douala" },
  { code: "GA", name: "Gabon", currency: "XAF", timezone: "Africa/Libreville" },
  { code: "CG", name: "Congo", currency: "XAF", timezone: "Africa/Brazzaville" },
  { code: "TD", name: "Tchad", currency: "XAF", timezone: "Africa/Ndjamena" },
  { code: "CF", name: "Centrafrique", currency: "XAF", timezone: "Africa/Bangui" },
  { code: "GQ", name: "Guinée équatoriale", currency: "XAF", timezone: "Africa/Malabo" },
  { code: "CD", name: "RD Congo", currency: "CDF", timezone: "Africa/Kinshasa" },
  { code: "GN", name: "Guinée", currency: "GNF", timezone: "Africa/Conakry" },
  { code: "GH", name: "Ghana", currency: "GHS", timezone: "Africa/Accra" },
  { code: "NG", name: "Nigéria", currency: "NGN", timezone: "Africa/Lagos" },
  { code: "MA", name: "Maroc", currency: "MAD", timezone: "Africa/Casablanca" },
  { code: "DZ", name: "Algérie", currency: "DZD", timezone: "Africa/Algiers" },
  { code: "TN", name: "Tunisie", currency: "TND", timezone: "Africa/Tunis" },
  { code: "MR", name: "Mauritanie", currency: "MRU", timezone: "Africa/Nouakchott" },
  { code: "MG", name: "Madagascar", currency: "MGA", timezone: "Indian/Antananarivo" },
  { code: "RW", name: "Rwanda", currency: "RWF", timezone: "Africa/Kigali" },
  { code: "KE", name: "Kenya", currency: "KES", timezone: "Africa/Nairobi" },
  { code: "ZA", name: "Afrique du Sud", currency: "ZAR", timezone: "Africa/Johannesburg" },
  { code: "FR", name: "France", currency: "EUR", timezone: "Europe/Paris" },
];

export const CURRENCIES: readonly { code: string; name: string }[] = [
  { code: "XOF", name: "Franc CFA (UEMOA) — FCFA" },
  { code: "XAF", name: "Franc CFA (CEMAC) — FCFA" },
  { code: "GHS", name: "Cedi ghanéen" },
  { code: "NGN", name: "Naira nigérian" },
  { code: "MAD", name: "Dirham marocain" },
  { code: "DZD", name: "Dinar algérien" },
  { code: "TND", name: "Dinar tunisien" },
  { code: "GNF", name: "Franc guinéen" },
  { code: "CDF", name: "Franc congolais" },
  { code: "MRU", name: "Ouguiya mauritanien" },
  { code: "MGA", name: "Ariary malgache" },
  { code: "RWF", name: "Franc rwandais" },
  { code: "KES", name: "Shilling kényan" },
  { code: "ZAR", name: "Rand sud-africain" },
  { code: "EUR", name: "Euro" },
  { code: "USD", name: "Dollar américain" },
];

export const SECTORS = [
  "Commerce & distribution", "Services", "Industrie & production", "BTP", "Transport & logistique",
  "Agriculture & agroalimentaire", "Santé", "Éducation & formation", "Hôtellerie & restauration",
  "Technologie & télécoms", "Énergie & mines", "ONG & associations", "Autre",
] as const;

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-500", "500+"] as const;

export const countryName = (code: string) => COUNTRIES.find((c) => c.code === code)?.name ?? code;

/** Formate un montant dans la devise de l'entreprise (FCFA sans décimales). */
export function formatMoney(amount: number | string, currency = "XOF", locale = "fr-FR"): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  const noDecimals = ["XOF", "XAF", "GNF", "CDF", "RWF", "MGA"].includes(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: currency === "XOF" || currency === "XAF" ? "code" : "symbol",
    maximumFractionDigits: noDecimals ? 0 : 2,
    minimumFractionDigits: noDecimals ? 0 : 2,
  })
    .format(n)
    .replace("XOF", "FCFA")
    .replace("XAF", "FCFA");
}

/**
 * Taux de TVA indicatifs proposés à la création d'une entreprise (valeurs de départ MODIFIABLES dans
 * Paramètres → Taxes ; aucun calcul n'en dépend en dur). À vérifier par l'entreprise.
 */
export const DEFAULT_VAT_RATE: Record<string, number> = {
  CI: 18, SN: 18, ML: 18, BF: 18, BJ: 18, TG: 18, NE: 19, GW: 15, CM: 19.25, GA: 18, CG: 18.9, TD: 18, CF: 19, GQ: 15,
  CD: 16, GN: 18, GH: 15, NG: 7.5, MA: 20, DZ: 19, TN: 19, MR: 16, MG: 20, RW: 18, KE: 16, ZA: 15, FR: 20,
};
