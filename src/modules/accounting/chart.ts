import type { Db } from "@/core/db/client";

/**
 * Plan comptable par défaut : sous-ensemble courant du plan SYSCOHADA révisé (comptes de 3 à 4 chiffres),
 * à adapter avec votre expert-comptable. Il est modifiable (ajout, renommage, désactivation) ; les écritures
 * automatiques s'appuient sur la table de correspondance ci-dessous, elle aussi paramétrable.
 */
export const DEFAULT_CHART: readonly [code: string, name: string][] = [
  // Classe 1 — Ressources durables
  ["101", "Capital social"], ["111", "Réserve légale"], ["121", "Report à nouveau créditeur"], ["129", "Report à nouveau débiteur"],
  ["131", "Résultat net : bénéfice"], ["139", "Résultat net : perte"], ["162", "Emprunts auprès des établissements de crédit"],
  // Classe 2 — Actif immobilisé
  ["215", "Logiciels et sites internet"], ["231", "Bâtiments"], ["241", "Matériel et outillage"], ["244", "Matériel et mobilier de bureau"], ["245", "Matériel de transport"],
  ["2844", "Amortissements du matériel et mobilier"], ["2845", "Amortissements du matériel de transport"],
  // Classe 3 — Stocks
  ["311", "Marchandises"], ["321", "Matières premières et fournitures"],
  // Classe 4 — Tiers
  ["401", "Fournisseurs"], ["408", "Fournisseurs — factures non parvenues"], ["409", "Fournisseurs débiteurs (avances et acomptes)"],
  ["411", "Clients"], ["416", "Clients douteux ou litigieux"], ["419", "Clients créditeurs (avances et acomptes reçus)"],
  ["421", "Personnel — rémunérations dues"], ["425", "Personnel — avances et acomptes"], ["431", "Sécurité sociale"], ["4431", "TVA facturée sur ventes"], ["4432", "TVA facturée sur prestations de services"],
  ["4441", "État, TVA due"], ["4449", "État, crédit de TVA à reporter"], ["4452", "TVA récupérable sur achats"], ["447", "État, impôts retenus à la source"], ["471", "Compte d'attente"],
  // Classe 5 — Trésorerie
  ["521", "Banques"], ["541", "Monnaie électronique (mobile money)"], ["571", "Caisse"], ["585", "Virements de fonds"],
  // Classe 6 — Charges
  ["601", "Achats de marchandises"], ["602", "Achats de matières premières"], ["6031", "Variations des stocks de marchandises"], ["605", "Autres achats (eau, énergie, fournitures)"], ["611", "Transports sur achats"], ["618", "Autres frais de transport"],
  ["622", "Locations et charges locatives"], ["624", "Entretien, réparations et maintenance"], ["627", "Publicité et relations publiques"], ["628", "Frais de télécommunications"],
  ["631", "Frais bancaires"], ["638", "Autres charges externes"], ["641", "Impôts et taxes"], ["658", "Charges diverses"], ["661", "Rémunérations du personnel"], ["664", "Charges sociales"],
  ["671", "Intérêts des emprunts"], ["681", "Dotations aux amortissements"],
  // Classe 7 — Produits
  ["701", "Ventes de marchandises"], ["702", "Ventes de produits finis"], ["706", "Services vendus"], ["707", "Produits accessoires"], ["711", "Subventions d'exploitation"], ["758", "Produits divers"], ["771", "Revenus financiers"],
];

export const DEFAULT_JOURNALS = [
  { code: "VTE", name: "Journal des ventes", type: "SALES" },
  { code: "ACH", name: "Journal des achats", type: "PURCHASES" },
  { code: "BQ", name: "Journal de banque", type: "BANK" },
  { code: "CAI", name: "Journal de caisse", type: "CASH" },
  { code: "OD", name: "Opérations diverses", type: "MISC" },
  { code: "AN", name: "Journal des à-nouveaux", type: "OPENING" },
] as const;

/** Clés des comptes utilisés par les écritures automatiques. */
export const MAPPING_KEYS = {
  customers: { label: "Clients", code: "411" },
  suppliers: { label: "Fournisseurs", code: "401" },
  sales_goods: { label: "Ventes de marchandises", code: "701" },
  sales_services: { label: "Services vendus", code: "706" },
  vat_collected: { label: "TVA facturée (collectée)", code: "4431" },
  vat_deductible: { label: "TVA récupérable sur achats", code: "4452" },
  purchases_goods: { label: "Achats de marchandises", code: "601" },
  purchases_other: { label: "Autres achats et services", code: "605" },
  treasury_bank: { label: "Trésorerie — banques", code: "521" },
  treasury_cash: { label: "Trésorerie — caisses", code: "571" },
  treasury_mobile: { label: "Trésorerie — mobile money", code: "541" },
  suspense: { label: "Compte d'attente", code: "471" },
  result_profit: { label: "Résultat : bénéfice", code: "131" },
  result_loss: { label: "Résultat : perte", code: "139" },
  payroll_expense: { label: "Paie : rémunérations brutes (charge)", code: "661" },
  payroll_social_expense: { label: "Paie : charges sociales patronales (charge)", code: "664" },
  payroll_net_due: { label: "Paie : salaires nets dus", code: "421" },
  payroll_social_due: { label: "Paie : organismes sociaux (cotisations dues)", code: "431" },
  payroll_tax_due: { label: "Paie : impôt retenu à la source", code: "447" },
  payroll_other_due: { label: "Paie : autres retenues (avances, acomptes)", code: "425" },
} as const;
export type MappingKey = keyof typeof MAPPING_KEYS;

/** Compte comptable par défaut des catégories financières créées avec l'entreprise. */
export const CATEGORY_LEDGER_CODES: Record<string, string> = {
  "Apport en capital": "101", "Subventions et aides": "711", "Autres produits": "758",
  "Loyer et charges locatives": "622", "Salaires et charges sociales": "661", "Transport et carburant": "618", "Électricité, eau, internet": "605", "Entretien et réparations": "624",
  "Fournitures de bureau": "605", "Marketing et publicité": "627", "Frais bancaires": "631", "Impôts et taxes": "641", "Déplacements et missions": "638", Divers: "658",
};

/** Libellés des groupes à 2 chiffres pour le compte de résultat. */
export const GROUP_LABELS: Record<string, string> = {
  "60": "Achats", "61": "Transports", "62": "Services extérieurs A", "63": "Services extérieurs B", "64": "Impôts et taxes", "65": "Autres charges", "66": "Charges de personnel",
  "67": "Frais financiers", "68": "Dotations aux amortissements", "70": "Ventes", "71": "Subventions d'exploitation", "72": "Production immobilisée", "75": "Autres produits", "77": "Revenus financiers", "78": "Transferts de charges",
};

const calendarYear = (year: number) => ({ start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 11, 31)) });

/** Crée (idempotent) l'exercice calendaire de `year` avec ses 12 périodes mensuelles. */
export async function ensureCalendarYear(tx: Db, companyId: string, year: number) {
  const { start, end } = calendarYear(year);
  const existing = await tx.fiscalYear.findFirst({ where: { companyId, startDate: { lte: end }, endDate: { gte: start } } });
  if (existing) return existing;
  return createFiscalYear(tx, companyId, String(year), start, end);
}

export async function createFiscalYear(tx: Db, companyId: string, name: string, start: Date, end: Date) {
  const fy = await tx.fiscalYear.create({ data: { companyId, name, startDate: start, endDate: end } });
  const periods: { companyId: string; fiscalYearId: string; startDate: Date; endDate: Date }[] = [];
  for (let cur = new Date(start); cur <= end; ) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    const last = new Date(next.getTime() - 86_400_000);
    periods.push({ companyId, fiscalYearId: fy.id, startDate: new Date(cur), endDate: last > end ? new Date(end) : last });
    cur = next;
  }
  await tx.accountingPeriod.createMany({ data: periods });
  return fy;
}

/**
 * Initialise (sans rien écraser) le plan comptable, les journaux, la table de correspondance et l'exercice de l'année en cours.
 * Appelée à la création de l'entreprise et paresseusement par le moteur d'écritures.
 */
export async function ensureAccountingDefaults(tx: Db, companyId: string) {
  if ((await tx.ledgerAccount.count({ where: { companyId } })) === 0) {
    await tx.ledgerAccount.createMany({ data: DEFAULT_CHART.map(([code, name]) => ({ companyId, code, name, class: Number(code[0]), isSystem: true })) });
  }
  if ((await tx.journal.count({ where: { companyId } })) === 0) {
    await tx.journal.createMany({ data: DEFAULT_JOURNALS.map((j) => ({ companyId, ...j })) });
  }
  // Comptes du plan par défaut absents (ajoutés dans une version ultérieure) : créés sans toucher aux comptes existants
  const existing = new Set((await tx.ledgerAccount.findMany({ where: { companyId }, select: { code: true } })).map((a) => a.code));
  const missing = DEFAULT_CHART.filter(([code]) => !existing.has(code));
  if (missing.length) await tx.ledgerAccount.createMany({ data: missing.map(([code, name]) => ({ companyId, code, name, class: Number(code[0]), isSystem: true })) });
  // Correspondances manquantes : ajoutées (celles que l'entreprise a déjà choisies ne sont jamais écrasées)
  const mapped = new Set((await tx.accountMapping.findMany({ where: { companyId }, select: { key: true } })).map((m) => m.key));
  const toMap = (Object.entries(MAPPING_KEYS) as [MappingKey, { code: string }][]).filter(([key]) => !mapped.has(key));
  if (toMap.length) {
    const byCode = new Map((await tx.ledgerAccount.findMany({ where: { companyId } })).map((a) => [a.code, a.id]));
    const data = toMap.filter(([, v]) => byCode.has(v.code)).map(([key, v]) => ({ companyId, key, ledgerAccountId: byCode.get(v.code)! }));
    if (data.length) await tx.accountMapping.createMany({ data });
  }
  if ((await tx.fiscalYear.count({ where: { companyId } })) === 0) await ensureCalendarYear(tx, companyId, new Date().getUTCFullYear());
  // Compte comptable des catégories financières existantes
  for (const [name, code] of Object.entries(CATEGORY_LEDGER_CODES)) {
    await tx.financeCategory.updateMany({ where: { companyId, name, ledgerCode: null }, data: { ledgerCode: code } });
  }
}
