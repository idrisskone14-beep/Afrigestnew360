import { suggestMapping, type FieldDef, type ImportEntity } from "./entities";

/**
 * Applications d'origine reconnues à l'import. Chacune ajoute des intitulés de colonnes habituels de ses exports aux intitulés
 * déjà reconnus ; la correspondance reste PROPOSÉE (jamais imposée) : l'utilisateur la vérifie et la corrige avant tout import.
 * Les intitulés sont comparés sans accents, majuscules ni ponctuation (voir `normHeader`).
 */
export const IMPORT_SOURCES = [
  { key: "excel", label: "Excel / CSV (modèle KAKO Gestion)" },
  { key: "sage", label: "Sage" },
  { key: "ciel", label: "Ciel" },
  { key: "odoo", label: "Odoo" },
  { key: "zoho", label: "Zoho Books" },
  { key: "quickbooks", label: "QuickBooks" },
] as const;
export type SourceKey = (typeof IMPORT_SOURCES)[number]["key"];

type Extra = Partial<Record<ImportEntity, Record<string, string[]>>>;

const sage: Extra = (() => {
  const contact = { name: ["intitule", "intituledutiers", "nomtiers", "raisonsociale"], email: ["emailtiers", "courrielfax"], address: ["adresse1", "complement"], taxId: ["ncc", "identifiant", "ndidentifiant", "numeroidentifiant", "numidentifiant"], rccm: ["nrccm"] };
  return {
    customers: contact, suppliers: contact,
    products: { sku: ["referencearticle", "codearticle"], name: ["designationarticle"], salePrice: ["pvht", "prixventeht", "tarifvente"], costPrice: ["paht", "prixachatht", "dernierprixdachat"], category: ["famille", "familledarticle"], unit: ["unitedevente"] },
    stock: { sku: ["referencearticle"], quantity: ["quantiteenstock", "qtestock", "stockreel"], warehouse: ["depot"], unitCost: ["cmup", "prixderevient", "pump"] },
    ledger: { code: ["ncompte", "comptegeneral"], name: ["intituledecompte"] },
    entries: { piece: ["npiece", "numpiece"], date: ["datepiece"], journal: ["codejournal"], account: ["compteg", "ncompteg", "comptegeneral"], label: ["libelleecriture"], debit: ["montantdebit"], credit: ["montantcredit"] },
    invoices: { number: ["nfacture", "numpiece", "npiece"], party: ["intituledutiers", "nomtiers"], date: ["datepiece"], dueDate: ["dateecheance"], total: ["netapayer", "montantttc"], subtotal: ["montantht"], balance: ["resteapayer", "soldedu"] },
    bills: { number: ["nfacture", "numpiece", "npiece"], party: ["intituledutiers", "nomtiers"], date: ["datepiece"], dueDate: ["dateecheance"], total: ["netapayer", "montantttc"], subtotal: ["montantht"], balance: ["resteapayer", "soldedu"] },
  };
})();

const odoo: Extra = (() => {
  const contact = { name: ["name", "displayname", "nomaffiche"], email: ["email"], phone: ["phone", "mobile"], address: ["street", "rue"], city: ["city"], country: ["country", "countryname"], taxId: ["taxid", "vat", "numerodetva", "tvaidnif"], website: ["website"] };
  return {
    customers: contact, suppliers: contact,
    products: { name: ["name", "productname"], sku: ["internalreference", "referenceinterne"], salePrice: ["salesprice"], costPrice: ["cost"], barcode: ["barcode"], category: ["productcategory", "categoriedarticle", "categoriedeproduit"], unit: ["unitofmeasure", "unitedemesure"], type: ["producttype", "typedarticle"], minStock: ["minimumquantity"] },
    stock: { sku: ["internalreference", "referenceinterne"], quantity: ["quantityonhand", "onhandquantity"], warehouse: ["location", "emplacement"], unitCost: ["cost"] },
    ledger: { code: ["code"], name: ["accountname", "name"] },
    entries: { piece: ["journalentry", "entry", "number"], date: ["date", "accountingdate"], journal: ["journal"], account: ["account"], label: ["label", "name"], debit: ["debit"], credit: ["credit"] },
    invoices: { number: ["number", "invoicenumber"], party: ["customer", "partner", "partenaire"], date: ["invoicedate"], dueDate: ["duedate"], total: ["total"], subtotal: ["untaxedamount", "montanthorstaxes"], balance: ["amountdue", "amountresidual", "montantdu"] },
    bills: { number: ["number", "reference", "billreference"], party: ["vendor", "partner", "partenaire"], date: ["billdate", "invoicedate"], dueDate: ["duedate"], total: ["total"], subtotal: ["untaxedamount"], balance: ["amountdue", "amountresidual", "montantdu"] },
  };
})();

const zoho: Extra = (() => {
  const contact = { name: ["displayname", "contactname", "companyname", "customername", "vendorname"], email: ["emailid"], phone: ["phone", "mobilephone"], address: ["billingaddress", "billingstreet"], city: ["billingcity"], country: ["billingcountry"], taxId: ["taxid", "taxregistrationnumber", "trn"], paymentTermsDays: ["paymentterms"], website: ["website"] };
  return {
    customers: contact, suppliers: contact,
    products: { name: ["itemname"], sku: ["sku"], salePrice: ["rate", "sellingprice"], costPrice: ["purchaserate", "purchaseprice"], unit: ["usageunit"], type: ["producttype", "itemtype"] },
    stock: { sku: ["sku"], quantity: ["stockonhand", "openingstock"], unitCost: ["purchaserate"] },
    invoices: { number: ["invoicenumber"], party: ["customername"], date: ["invoicedate"], dueDate: ["duedate"], total: ["total"], balance: ["balance"] },
    bills: { number: ["billnumber"], party: ["vendorname"], date: ["billdate"], dueDate: ["duedate"], total: ["total"], balance: ["balance"] },
  };
})();

const quickbooks: Extra = (() => {
  const contact = { name: ["customer", "vendor", "displayname", "company", "fullname"], email: ["mainemail"], phone: ["mainphone", "mobile"], address: ["billingstreet", "billingaddress", "billtostreet"], city: ["billingcity", "billtocity"], country: ["billingcountry", "billtocountry"], notes: ["notes"] };
  return {
    customers: contact, suppliers: contact,
    products: { name: ["name", "itemname"], sku: ["sku"], salePrice: ["salesprice", "price", "rate"], costPrice: ["cost", "purchasecost"], description: ["salesdescription"] },
    stock: { sku: ["sku"], quantity: ["qtyonhand", "quantityonhand"], unitCost: ["cost", "avgcost"] },
    invoices: { number: ["num", "invoiceno", "docnumber"], party: ["customer", "name"], date: ["date", "txndate", "invoicedate"], dueDate: ["duedate"], total: ["amount", "originalamount", "total"], balance: ["openbalance", "balance"] },
    bills: { number: ["num", "refno", "billno"], party: ["vendor", "name"], date: ["date", "txndate", "billdate"], dueDate: ["duedate"], total: ["amount", "originalamount", "total"], balance: ["openbalance", "balance"] },
  };
})();

const EXTRA: Record<SourceKey, Extra> = { excel: {}, sage, ciel: sage, odoo, zoho, quickbooks };

/** Correspondance proposée pour chaque application : { source → { champ → indice de colonne } }. */
export function suggestBySource(entity: ImportEntity, headers: string[], fields: FieldDef[]): Record<SourceKey, Record<string, number>> {
  return Object.fromEntries(IMPORT_SOURCES.map((s) => [s.key, suggestMapping(headers, fields, EXTRA[s.key][entity] ?? {})])) as Record<SourceKey, Record<string, number>>;
}

/** Application la plus probable : celle qui reconnaît le plus de colonnes (à égalité, le modèle générique). */
export function detectSource(suggestions: Record<SourceKey, Record<string, number>>): SourceKey {
  let best: SourceKey = "excel";
  let bestCount = Object.keys(suggestions.excel).length;
  for (const s of IMPORT_SOURCES) {
    const n = Object.keys(suggestions[s.key]).length;
    if (n > bestCount) { best = s.key; bestCount = n; }
  }
  return best;
}
