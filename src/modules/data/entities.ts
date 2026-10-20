import "server-only";
import { z } from "zod";
import { d } from "@/core/money";
import { NUMBERING_DEFAULTS } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import { COUNTRIES } from "@/lib/reference-data";
import { ledgerAccountSchema } from "@/modules/accounting/schemas";
import * as accounting from "@/modules/accounting/service";
import { customerSchema } from "@/modules/crm/schemas";
import * as crm from "@/modules/crm/service";
import { canSeePay } from "@/modules/hr/employees";
import * as hrEmployees from "@/modules/hr/employees";
import { employeeSchema } from "@/modules/hr/schemas";
import { movementSchema, productSchema } from "@/modules/inventory/schemas";
import * as inventory from "@/modules/inventory/service";
import { supplierSchema } from "@/modules/purchasing/schemas";
import * as suppliers from "@/modules/purchasing/suppliers";
import { createOpeningBill, createOpeningInvoice } from "./opening";
import { normHeader, parseBool, parseDateText, parseNumber } from "./parse";

type Ctx = TenantContext;
export const IMPORT_ENTITIES = ["customers", "suppliers", "employees", "products", "stock", "invoices", "bills", "ledger", "entries"] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];
export const isImportEntity = (v: string): v is ImportEntity => (IMPORT_ENTITIES as readonly string[]).includes(v);

export interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
  /** Intitulés de colonne reconnus automatiquement (comparés sans accents ni ponctuation). */
  aliases: string[];
  /** Champ sensible (salaire, pièce d'identité) : proposé seulement aux profils habilités. */
  sensitive?: boolean;
  hint?: string;
}

export interface Prepared {
  input?: unknown;
  errors: string[];
  identity: string;
  /** Entités « pièces » : clé de la pièce à laquelle appartient la ligne (plusieurs lignes du fichier = un enregistrement). */
  group?: string;
}
type Values = Record<string, string>;
type Lookups = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- chaque entité charge ses propres références

export interface EntityDef {
  key: ImportEntity;
  label: string;
  module: string;
  /** Droit de CRÉATION requis, en plus de `data.import.manage` : on n'importe que ce qu'on peut créer à la main. */
  permission: string;
  fields: FieldDef[];
  /** Ligne d'exemple du modèle téléchargeable. */
  sample: string[];
  /** Conseil affiché sous le choix des données (prérequis, effets de l'import). */
  note?: string;
  loadLookups: (ctx: Ctx) => Promise<Lookups>;
  prepare: (ctx: Ctx, v: Values, lk: Lookups) => Prepared;
  /** Déjà présent en base ? (ignoré à l'import : un même fichier peut être rejoué sans doublon) */
  exists: (lk: Lookups, p: Prepared) => boolean;
  /** Création d'une ligne (entités simples). */
  create?: (ctx: Ctx, input: never) => Promise<unknown>;
  /** Entités « pièces » (écritures comptables) : les lignes d'une même pièce sont contrôlées et créées ensemble. */
  group?: GroupDef;
}

export interface GroupDef {
  /** Contrôle de la pièce entière (équilibre…) : message d'erreur, ou null si elle est valide. */
  check: (inputs: any[]) => string | null; // eslint-disable-line @typescript-eslint/no-explicit-any -- chaque entité type ses lignes
  create: (ctx: Ctx, inputs: any[]) => Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const low = (s: string) => s.trim().toLowerCase();
const key = (s: string) => normHeader(s);

/** Messages d'erreur lisibles à partir d'une erreur Zod, avec le libellé de la colonne. */
function zodErrors(err: z.ZodError, labels: Record<string, string>): string[] {
  return Object.entries(z.flattenError(err).fieldErrors).flatMap(([k, msgs]) => (msgs as string[]).map((m) => `${labels[k] ?? k} : ${m}`));
}
const labelsOf = (fields: FieldDef[]) => Object.fromEntries(fields.map((f) => [f.key, f.label]));

function country(raw: string, label: string, errors: string[]): string {
  if (!raw) return "";
  const k = key(raw);
  const c = COUNTRIES.find((x) => key(x.code) === k || key(x.name) === k);
  if (!c) { errors.push(`${label} : pays inconnu « ${raw} » (code ISO ou nom).`); return ""; }
  return c.code;
}
function num(raw: string, label: string, errors: string[], opts: { def?: number; int?: boolean } = {}): number | "" {
  if (raw === "") return opts.def ?? "";
  const n = parseNumber(raw);
  if (n === null) { errors.push(`${label} : nombre invalide « ${raw} ».`); return ""; }
  if (opts.int && !Number.isInteger(n)) { errors.push(`${label} : un nombre entier est attendu.`); return ""; }
  return n;
}
function date(raw: string, label: string, errors: string[]): string {
  if (!raw) return "";
  const d = parseDateText(raw);
  if (!d) { errors.push(`${label} : date invalide « ${raw} » (utilisez JJ/MM/AAAA ou AAAA-MM-JJ).`); return ""; }
  return d;
}

// ═══ Clients ══════════════════════════════════════════════════

const CUSTOMER_FIELDS: FieldDef[] = [
  { key: "name", label: "Nom / raison sociale", required: true, aliases: ["nom", "raisonsociale", "client", "denomination", "societe", "name"] },
  { key: "type", label: "Type (entreprise / particulier)", aliases: ["type", "typedeclient", "categorie"] },
  { key: "email", label: "E-mail", aliases: ["email", "courriel", "mail", "adresseemail"] },
  { key: "phone", label: "Téléphone", aliases: ["telephone", "tel", "phone", "mobile", "portable"] },
  { key: "address", label: "Adresse", aliases: ["adresse", "address", "rue"] },
  { key: "city", label: "Ville", aliases: ["ville", "city", "localite"] },
  { key: "country", label: "Pays", aliases: ["pays", "country"] },
  { key: "taxId", label: "Identifiant fiscal", aliases: ["identifiantfiscal", "nif", "ncc", "numerocontribuable", "taxid", "tva"] },
  { key: "rccm", label: "RCCM", aliases: ["rccm", "registredecommerce"] },
  { key: "website", label: "Site web", aliases: ["siteweb", "site", "website", "url"] },
  { key: "paymentTermsDays", label: "Délai de paiement (jours)", aliases: ["delaidepaiement", "delai", "delaij", "echeance", "paymentterms", "joursdepaiement"] },
  { key: "creditLimit", label: "Plafond de crédit", aliases: ["plafonddecredit", "plafond", "encoursmaximum", "creditlimit"] },
  { key: "notes", label: "Notes", aliases: ["notes", "note", "remarques", "commentaire", "commentaires"] },
];

function partyType(raw: string, errors: string[]): "COMPANY" | "INDIVIDUAL" {
  const k = key(raw);
  if (!k || ["entreprise", "societe", "company", "pro", "professionnel", "sarl", "sa"].includes(k)) return "COMPANY";
  if (["particulier", "individual", "personne", "individu", "personnephysique"].includes(k)) return "INDIVIDUAL";
  errors.push(`Type : « ${raw} » inconnu (entreprise ou particulier).`);
  return "COMPANY";
}

const customers: EntityDef = {
  key: "customers", label: "Clients", module: "crm", permission: "crm.customer.create", fields: CUSTOMER_FIELDS,
  sample: ["Quincaillerie Koffi & Fils", "Entreprise", "contact@koffi.ci", "+225 07 00 00 00 00", "Cocody, Riviera", "Abidjan", "CI", "2112345 A", "", "", "30", "1000000", ""],
  async loadLookups(ctx) {
    const rows = await ctx.db.customer.findMany({ where: { deletedAt: null }, select: { name: true, email: true } });
    return { names: new Set(rows.map((r) => low(r.name))), emails: new Set(rows.flatMap((r) => (r.email ? [low(r.email)] : []))) };
  },
  prepare(_ctx, v) {
    const errors: string[] = [];
    const raw = { type: partyType(v.type ?? "", errors), name: v.name ?? "", email: v.email ?? "", phone: v.phone ?? "", address: v.address ?? "", city: v.city ?? "", country: country(v.country ?? "", "Pays", errors), taxId: v.taxId ?? "", rccm: v.rccm ?? "", website: v.website ?? "", paymentTermsDays: num(v.paymentTermsDays ?? "", "Délai de paiement", errors, { def: 30, int: true }), creditLimit: num(v.creditLimit ?? "", "Plafond de crédit", errors), notes: v.notes ?? "" };
    const r = customerSchema.safeParse(raw);
    if (!r.success) errors.push(...zodErrors(r.error, labelsOf(CUSTOMER_FIELDS)));
    const identity = raw.email ? `e:${low(raw.email)}` : `n:${low(raw.name)}`;
    return { input: r.success ? r.data : undefined, errors, identity };
  },
  exists: (lk, p) => (p.identity.startsWith("e:") ? lk.emails.has(p.identity.slice(2)) : lk.names.has(p.identity.slice(2))),
  create: (ctx, input) => crm.createCustomer(ctx, input),
};

// ═══ Fournisseurs ═════════════════════════════════════════════

const SUPPLIER_FIELDS = CUSTOMER_FIELDS.filter((f) => !["type", "website", "creditLimit"].includes(f.key)).map((f) => (f.key === "name" ? { ...f, aliases: [...f.aliases, "fournisseur"] } : f));

const suppliersDef: EntityDef = {
  key: "suppliers", label: "Fournisseurs", module: "purchases", permission: "purchases.supplier.create", fields: SUPPLIER_FIELDS,
  sample: ["Cimenterie du Golfe", "ventes@cimgolfe.ci", "+225 21 00 00 00", "Zone industrielle", "Abidjan", "CI", "1234567 B", "", "30", ""],
  async loadLookups(ctx) {
    const rows = await ctx.db.supplier.findMany({ where: { deletedAt: null }, select: { name: true, email: true } });
    return { names: new Set(rows.map((r) => low(r.name))), emails: new Set(rows.flatMap((r) => (r.email ? [low(r.email)] : []))) };
  },
  prepare(_ctx, v) {
    const errors: string[] = [];
    const raw = { name: v.name ?? "", email: v.email ?? "", phone: v.phone ?? "", address: v.address ?? "", city: v.city ?? "", country: country(v.country ?? "", "Pays", errors), taxId: v.taxId ?? "", rccm: v.rccm ?? "", paymentTermsDays: num(v.paymentTermsDays ?? "", "Délai de paiement", errors, { def: 30, int: true }), notes: v.notes ?? "" };
    const r = supplierSchema.safeParse(raw);
    if (!r.success) errors.push(...zodErrors(r.error, labelsOf(SUPPLIER_FIELDS)));
    return { input: r.success ? r.data : undefined, errors, identity: raw.email ? `e:${low(raw.email)}` : `n:${low(raw.name)}` };
  },
  exists: (lk, p) => (p.identity.startsWith("e:") ? lk.emails.has(p.identity.slice(2)) : lk.names.has(p.identity.slice(2))),
  create: (ctx, input) => suppliers.createSupplier(ctx, input),
};

// ═══ Salariés ═════════════════════════════════════════════════

const EMPLOYEE_FIELDS: FieldDef[] = [
  { key: "firstName", label: "Prénom", required: true, aliases: ["prenom", "prenoms", "firstname"] },
  { key: "lastName", label: "Nom", required: true, aliases: ["nom", "nomdefamille", "lastname", "surname"] },
  { key: "hireDate", label: "Date d'embauche", required: true, aliases: ["dateembauche", "dateentree", "embauche", "datedentree", "hiredate", "dateembauchele"] },
  { key: "email", label: "E-mail", aliases: ["email", "courriel", "mail"] },
  { key: "phone", label: "Téléphone", aliases: ["telephone", "tel", "phone", "mobile"] },
  { key: "birthDate", label: "Date de naissance", aliases: ["datenaissance", "naissance", "datedenaissance", "birthdate"] },
  { key: "address", label: "Adresse", aliases: ["adresse", "address"] },
  { key: "city", label: "Ville", aliases: ["ville", "city"] },
  { key: "jobTitle", label: "Poste", aliases: ["poste", "fonction", "titre", "jobtitle", "emploi"] },
  { key: "department", label: "Département (nom)", aliases: ["departement", "service", "department", "direction"] },
  { key: "branch", label: "Agence (nom)", aliases: ["agence", "branch", "site", "etablissement"] },
  { key: "payoutMethod", label: "Mode de paiement du salaire", aliases: ["modedepaiement", "paiement", "payoutmethod", "modereglement"] },
  { key: "baseSalary", label: "Salaire de base", sensitive: true, aliases: ["salaire", "salairedebase", "remuneration", "basesalary", "salairebrut"] },
  { key: "nationalId", label: "Pièce d'identité", sensitive: true, aliases: ["pieceidentite", "cni", "nationalid", "numeropiece", "identite"] },
];

const employeesDef: EntityDef = {
  key: "employees", label: "Salariés", module: "hr", permission: "hr.employee.create", fields: EMPLOYEE_FIELDS,
  sample: ["Awa", "Koné", "06/01/2024", "awa.kone@exemple.ci", "+225 07 00 00 00 00", "12/05/1992", "Cocody", "Abidjan", "Comptable", "Administration", "", "Virement", "450000", ""],
  async loadLookups(ctx) {
    const [deps, branches, emps] = await Promise.all([
      ctx.db.department.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true } }),
      ctx.db.branch.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true } }),
      ctx.db.employee.findMany({ where: { deletedAt: null }, select: { firstName: true, lastName: true, hireDate: true, email: true } }),
    ]);
    return {
      departments: new Map(deps.map((x) => [key(x.name), x.id])), branches: new Map(branches.map((x) => [key(x.name), x.id])),
      emails: new Set(emps.flatMap((e) => (e.email ? [low(e.email)] : []))), people: new Set(emps.map((e) => `${low(e.firstName)}|${low(e.lastName)}|${e.hireDate.toISOString().slice(0, 10)}`)),
    };
  },
  prepare(ctx, v, lk) {
    const errors: string[] = [];
    const pay = canSeePay(ctx);
    const ref = (raw: string, map: Map<string, string>, label: string) => { if (!raw) return ""; const id = map.get(key(raw)); if (!id) errors.push(`${label} « ${raw} » introuvable : créez-le d'abord dans Paramètres → Organisation.`); return id ?? ""; };
    const method = (() => {
      const k = key(v.payoutMethod ?? "");
      if (!k || ["virement", "banque", "banktransfer", "virementbancaire"].includes(k)) return "BANK_TRANSFER";
      if (["especes", "cash", "caisse"].includes(k)) return "CASH";
      if (["mobilemoney", "mobile", "momo", "orangemoney", "wave"].includes(k)) return "MOBILE_MONEY";
      errors.push(`Mode de paiement : « ${v.payoutMethod} » inconnu (virement, espèces ou mobile money).`);
      return "BANK_TRANSFER";
    })();
    const salary = pay ? num(v.baseSalary ?? "", "Salaire de base", errors, { def: 0 }) : 0;
    const raw = {
      firstName: v.firstName ?? "", lastName: v.lastName ?? "", email: v.email ?? "", phone: v.phone ?? "", birthDate: date(v.birthDate ?? "", "Date de naissance", errors), nationalId: pay ? v.nationalId ?? "" : "",
      address: v.address ?? "", city: v.city ?? "", hireDate: date(v.hireDate ?? "", "Date d'embauche", errors), jobTitle: v.jobTitle ?? "", departmentId: ref(v.department ?? "", lk.departments, "Département"),
      branchId: ref(v.branch ?? "", lk.branches, "Agence"), baseSalary: salary === "" ? 0 : salary, payoutMethod: method,
    };
    const r = employeeSchema.safeParse(raw);
    if (!r.success) errors.push(...zodErrors(r.error, { ...labelsOf(EMPLOYEE_FIELDS), departmentId: "Département", branchId: "Agence" }));
    return { input: r.success ? r.data : undefined, errors, identity: raw.email ? `e:${low(raw.email)}` : `p:${low(raw.firstName)}|${low(raw.lastName)}|${raw.hireDate}` };
  },
  exists: (lk, p) => (p.identity.startsWith("e:") ? lk.emails.has(p.identity.slice(2)) : lk.people.has(p.identity.slice(2))),
  create: (ctx, input) => hrEmployees.createEmployee(ctx, input),
};

// ═══ Produits ═════════════════════════════════════════════════

const PRODUCT_FIELDS: FieldDef[] = [
  { key: "name", label: "Désignation", required: true, aliases: ["designation", "nom", "produit", "libelle", "article", "name"] },
  { key: "sku", label: "Référence (SKU)", aliases: ["reference", "ref", "sku", "code", "codearticle"] },
  { key: "type", label: "Type (bien / service)", aliases: ["type", "nature"] },
  { key: "category", label: "Catégorie (nom)", aliases: ["categorie", "famille", "category"] },
  { key: "unit", label: "Unité", aliases: ["unite", "unit", "conditionnement"] },
  { key: "salePrice", label: "Prix de vente", aliases: ["prixdevente", "prixvente", "pv", "prix", "saleprice", "prixht"] },
  { key: "costPrice", label: "Coût d'achat", aliases: ["coutdachat", "prixdachat", "pa", "cout", "costprice", "prixachat"] },
  { key: "barcode", label: "Code-barres", aliases: ["codebarres", "codebarre", "ean", "barcode", "gencod"] },
  { key: "minStock", label: "Seuil minimum de stock", aliases: ["seuil", "stockminimum", "stockmin", "seuilminimum", "minstock"] },
  { key: "trackStock", label: "Suivi de stock (oui/non)", aliases: ["suivistock", "gestiondestock", "stocke", "trackstock"] },
  { key: "description", label: "Description", aliases: ["description", "details", "desc"] },
];

const productsDef: EntityDef = {
  key: "products", label: "Produits et services", module: "inventory", permission: "inventory.product.create", fields: PRODUCT_FIELDS,
  sample: ["Ciment CPJ 42,5 — sac 50 kg", "CIM-50", "Bien", "Matériaux", "sac", "6500", "5100", "", "100", "oui", ""],
  async loadLookups(ctx) {
    const [cats, prods] = await Promise.all([
      ctx.db.productCategory.findMany({ select: { id: true, name: true } }),
      ctx.db.product.findMany({ where: { deletedAt: null }, select: { sku: true, name: true } }),
    ]);
    return { categories: new Map(cats.map((c) => [key(c.name), c.id])), skus: new Set(prods.map((p) => p.sku.toUpperCase())), names: new Set(prods.map((p) => low(p.name))) };
  },
  prepare(_ctx, v, lk) {
    const errors: string[] = [];
    const t = key(v.type ?? "");
    const type = !t || ["bien", "marchandise", "produit", "goods", "article", "matiere"].includes(t) ? "GOODS" : ["service", "prestation", "services"].includes(t) ? "SERVICE" : (errors.push(`Type : « ${v.type} » inconnu (bien ou service).`), "GOODS");
    let categoryId = "";
    if (v.category) { categoryId = lk.categories.get(key(v.category)) ?? ""; if (!categoryId) errors.push(`Catégorie « ${v.category} » introuvable : créez-la d'abord dans Stock → Produits.`); }
    const track = v.trackStock ? parseBool(v.trackStock) : type === "GOODS";
    if (track === null) errors.push(`Suivi de stock : « ${v.trackStock} » (oui ou non attendu).`);
    const raw = { sku: (v.sku ?? "").trim(), name: v.name ?? "", description: v.description ?? "", type, categoryId, unit: v.unit?.trim() || "unité", barcode: v.barcode ?? "", salePrice: num(v.salePrice ?? "", "Prix de vente", errors, { def: 0 }), costPrice: num(v.costPrice ?? "", "Coût d'achat", errors, { def: 0 }), taxId: "", trackStock: type === "GOODS" && track !== false, minStock: num(v.minStock ?? "", "Seuil minimum", errors, { def: 0 }) };
    const r = productSchema.safeParse(raw);
    if (!r.success) errors.push(...zodErrors(r.error, { ...labelsOf(PRODUCT_FIELDS), categoryId: "Catégorie" }));
    return { input: r.success ? r.data : undefined, errors, identity: raw.sku ? `s:${raw.sku.toUpperCase()}` : `n:${low(raw.name)}` };
  },
  exists: (lk, p) => (p.identity.startsWith("s:") ? lk.skus.has(p.identity.slice(2)) : lk.names.has(p.identity.slice(2))),
  create: (ctx, input) => inventory.createProduct(ctx, input),
};

// ═══ Stocks (quantités comptées) ══════════════════════════════

const STOCK_FIELDS: FieldDef[] = [
  { key: "sku", label: "Référence produit (SKU)", required: true, aliases: ["reference", "ref", "sku", "code", "codearticle", "produit"] },
  { key: "quantity", label: "Quantité comptée", required: true, aliases: ["quantite", "qte", "stock", "quantity", "quantitecomptee", "qtecomptee"] },
  { key: "warehouse", label: "Entrepôt (nom ou code)", aliases: ["entrepot", "depot", "warehouse", "magasin", "codeentrepot"] },
  { key: "unitCost", label: "Coût unitaire", aliases: ["cout", "coutunitaire", "prixdachat", "unitcost", "pa"] },
];

const stockDef: EntityDef = {
  key: "stock", label: "Stocks (quantités comptées)", module: "inventory", permission: "inventory.stock.adjust", fields: STOCK_FIELDS,
  note: "Importez d'abord vos produits : le stock est repris par une régularisation par produit et entrepôt.",
  sample: ["CIM-50", "400", "Entrepôt principal", "5100"],
  async loadLookups(ctx) {
    const [prods, whs] = await Promise.all([
      ctx.db.product.findMany({ where: { deletedAt: null }, select: { id: true, sku: true, trackStock: true } }),
      ctx.db.warehouse.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true, code: true, isDefault: true } }),
    ]);
    const wmap = new Map<string, string>();
    for (const w of whs) { wmap.set(key(w.name), w.id); wmap.set(key(w.code), w.id); }
    return { products: new Map(prods.map((p) => [p.sku.toUpperCase(), p])), warehouses: wmap, only: whs.length === 1 ? whs[0]!.id : whs.find((w) => w.isDefault)?.id ?? "" };
  },
  prepare(_ctx, v, lk) {
    const errors: string[] = [];
    const prod = lk.products.get((v.sku ?? "").trim().toUpperCase());
    if (!v.sku) errors.push("Référence produit : valeur requise.");
    else if (!prod) errors.push(`Produit « ${v.sku} » introuvable (référence inconnue).`);
    else if (!prod.trackStock) errors.push(`Produit « ${v.sku} » : le suivi de stock n'est pas activé.`);
    const wh = v.warehouse ? lk.warehouses.get(key(v.warehouse)) : lk.only;
    if (!wh) errors.push(v.warehouse ? `Entrepôt « ${v.warehouse} » introuvable.` : "Entrepôt : à préciser (plusieurs entrepôts, aucun par défaut).");
    const q = num(v.quantity ?? "", "Quantité comptée", errors);
    if (q === "" && v.quantity === "") errors.push("Quantité comptée : valeur requise.");
    const cost = num(v.unitCost ?? "", "Coût unitaire", errors);
    const raw = { kind: "ADJUSTMENT", productId: prod?.id ?? "", warehouseId: wh ?? "", quantity: q, unitCost: cost, reason: "Import de stock" };
    const r = movementSchema.safeParse(raw);
    if (!r.success && errors.length === 0) errors.push(...zodErrors(r.error, { quantity: "Quantité comptée", unitCost: "Coût unitaire", productId: "Produit", warehouseId: "Entrepôt" }));
    return { input: r.success ? r.data : undefined, errors, identity: `${prod?.id ?? "?"}|${wh ?? "?"}` };
  },
  exists: () => false,
  create: (ctx, input) => inventory.manualMovement(ctx, input),
};

// ═══ Soldes d'ouverture : factures encore ouvertes ════════════

interface Party { id: string; name: string; terms: number }
const byName = (rows: Party[]) => { const m = new Map<string, Party[]>(); for (const r of rows) m.set(key(r.name), [...(m.get(key(r.name)) ?? []), r]); return m; };
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const openingFields = (number: { label: string; aliases: string[] }, party: { label: string; aliases: string[] }): FieldDef[] => [
  { key: "number", label: number.label, required: true, aliases: number.aliases },
  { key: "party", label: party.label, required: true, aliases: party.aliases },
  { key: "date", label: "Date de la facture", required: true, aliases: ["datefacture", "datedefacture", "dateemission", "datedemission", "invoicedate", "billdate", "date"] },
  { key: "dueDate", label: "Date d'échéance", aliases: ["echeance", "dateecheance", "datedecheance", "duedate", "datelimite", "datelimitedepaiement"] },
  { key: "total", label: "Total TTC", required: true, aliases: ["totalttc", "ttc", "montantttc", "montant", "total", "amount", "totalamount"] },
  { key: "subtotal", label: "Total HT", aliases: ["totalht", "ht", "montantht", "subtotal", "horstaxe", "horstaxes"] },
  { key: "amountPaid", label: "Déjà réglé", hint: "Part déjà encaissée (ou payée) : le reste dû est repris.", aliases: ["dejaregle", "dejapaye", "dejaencaisse", "regle", "paye", "encaisse", "montantregle", "montantpaye", "amountpaid", "paid"] },
  { key: "balance", label: "Reste à payer", hint: "Si « Déjà réglé » est absent : déjà réglé = total TTC − reste à payer.", aliases: ["resteapayer", "reste", "resteadu", "soldedu", "solde", "balance", "amountdue", "amountresidual", "residual", "montantdu", "montantrestant", "outstanding", "openbalance"] },
  { key: "notes", label: "Notes", aliases: ["notes", "note", "objet", "libelle", "description", "commentaire", "commentaires"] },
];

/**
 * Facture encore ouverte dans l'application d'origine → solde d'ouverture. Seules les factures dont il reste quelque chose à payer sont reprises.
 * Le total HT est facultatif (sans lui, la TVA n'est pas détaillée : le total est repris comme montant hors taxe).
 */
function prepareOpening(kind: "invoice" | "bill", v: Values, lk: Lookups): Prepared {
  const errors: string[] = [];
  const noun = kind === "invoice" ? "client" : "fournisseur";
  const numberLabel = kind === "invoice" ? "N° de facture" : "N° de facture fournisseur";
  const number = (v.number ?? "").trim();
  if (!number) errors.push(`${numberLabel} : valeur requise.`);
  else if (kind === "invoice" && lk.prefix && number.toUpperCase().startsWith(`${String(lk.prefix).toUpperCase()}-`)) {
    errors.push(`${numberLabel} « ${number} » : ce numéro ressemble à la numérotation automatique (${lk.prefix}-…) et entrerait en conflit avec vos prochaines factures. Ajoutez un préfixe (ex. ANC-${number}).`);
  }
  const name = (v.party ?? "").trim();
  let party: Party | undefined;
  if (!name) errors.push(`${noun === "client" ? "Client" : "Fournisseur"} : valeur requise.`);
  else {
    const found: Party[] = lk.parties.get(key(name)) ?? [];
    if (found.length === 0) errors.push(`${noun === "client" ? "Client" : "Fournisseur"} « ${name} » introuvable : importez d'abord vos ${noun}s.`);
    else if (found.length > 1) errors.push(`Plusieurs ${noun}s portent le nom « ${name} » : précisez-le.`);
    else party = found[0];
  }
  const issue = date(v.date ?? "", "Date de la facture", errors);
  if (!v.date) errors.push("Date de la facture : valeur requise.");
  const dueRaw = date(v.dueDate ?? "", "Date d'échéance", errors);
  const total = num(v.total ?? "", "Total TTC", errors);
  if (!v.total) errors.push("Total TTC : valeur requise.");
  const sub = num(v.subtotal ?? "", "Total HT", errors);
  const balance = num(v.balance ?? "", "Reste à payer", errors);
  const paidRaw = num(v.amountPaid ?? "", "Déjà réglé", errors);
  // « Reste à payer » est la forme la plus courante des exports de factures ouvertes : le réglé s'en déduit
  const paid = paidRaw !== "" ? paidRaw : typeof balance === "number" && typeof total === "number" ? Math.max(0, total - balance) : 0;
  if (typeof balance === "number" && (balance < 0 || (typeof total === "number" && balance > total))) errors.push("Reste à payer : doit être compris entre 0 et le total TTC.");
  if (typeof total === "number") {
    if (total <= 0) errors.push("Total TTC : un montant positif est attendu.");
    if (typeof sub === "number" && (sub < 0 || sub > total)) errors.push("Total HT : doit être compris entre 0 et le total TTC.");
    if (paid < 0) errors.push("Déjà réglé : un montant positif est attendu.");
    else if (paid >= total) errors.push("Facture déjà soldée : seules les factures ouvertes (reste à payer) sont reprises.");
  }
  const identity = kind === "invoice" ? `n:${low(number)}` : `${party?.id ?? "?"}|${low(number)}`;
  if (errors.length > 0 || !party || typeof total !== "number") return { errors, identity };
  const subtotal = typeof sub === "number" ? sub : total;
  const input = {
    number, partyId: party.id, partyName: party.name, date: issue, dueDate: dueRaw || addDays(issue, party.terms),
    subtotal, taxTotal: d(total).minus(subtotal).toNumber(), total, amountPaid: paid, notes: (v.notes ?? "").trim().slice(0, 500),
  };
  return { input, errors, identity };
}

const invoicesDef: EntityDef = {
  key: "invoices", label: "Factures clients impayées (soldes d'ouverture)", module: "sales", permission: "finance.invoice.create",
  note: "Importez d'abord vos clients. Seules les factures dont il reste quelque chose à payer sont reprises, avec leur numéro et leurs dates d'origine ; elles alimentent les créances et l'échéancier, mais ne créent aucune écriture comptable (reprenez vos soldes par la balance d'ouverture).",
  fields: openingFields(
    { label: "N° de facture", aliases: ["numerodefacture", "numerofacture", "nfacture", "numero", "facture", "invoicenumber", "invoiceno", "piece", "numpiece", "ref", "reference"] },
    { label: "Client (nom)", aliases: ["client", "nomclient", "nomdutiers", "tiers", "raisonsociale", "customer", "customername", "partner"] },
  ),
  sample: ["FA-2025-0123", "Quincaillerie Koffi & Fils", "15/09/2025", "15/10/2025", "1180000", "1000000", "300000", "", "Solde d'ouverture"],
  async loadLookups(ctx) {
    const [rows, nums, cfg] = await Promise.all([
      ctx.db.customer.findMany({ where: { deletedAt: null }, select: { id: true, name: true, paymentTermsDays: true } }),
      ctx.db.invoice.findMany({ where: { number: { not: null } }, select: { number: true } }),
      ctx.db.numberingConfig.findFirst({ where: { key: "invoice" }, select: { prefix: true } }),
    ]);
    return { parties: byName(rows.map((r) => ({ id: r.id, name: r.name, terms: r.paymentTermsDays }))), numbers: new Set(nums.map((n) => low(n.number!))), prefix: cfg?.prefix ?? NUMBERING_DEFAULTS.invoice.prefix };
  },
  prepare: (_ctx, v, lk) => prepareOpening("invoice", v, lk),
  exists: (lk, p) => lk.numbers.has(p.identity.slice(2)),
  create: (ctx, input) => createOpeningInvoice(ctx, input),
};

const billsDef: EntityDef = {
  key: "bills", label: "Factures fournisseurs impayées (soldes d'ouverture)", module: "purchases", permission: "purchases.bill.create",
  note: "Importez d'abord vos fournisseurs. Seules les factures non soldées sont reprises (numéro d'origine conservé comme référence fournisseur) ; elles alimentent les dettes et l'échéancier, mais ne créent aucune écriture comptable.",
  fields: openingFields(
    { label: "N° de facture fournisseur", aliases: ["numerodefacture", "numerofacture", "nfacture", "numero", "facture", "invoicenumber", "billnumber", "reffournisseur", "referencefournisseur", "piece", "ref", "reference"] },
    { label: "Fournisseur (nom)", aliases: ["fournisseur", "nomfournisseur", "nomdutiers", "tiers", "raisonsociale", "vendor", "vendorname", "supplier", "suppliername", "partner"] },
  ),
  sample: ["FF-884", "Cimenterie du Golfe", "02/09/2025", "02/10/2025", "590000", "500000", "0", "", "Solde d'ouverture"],
  async loadLookups(ctx) {
    const [rows, bills] = await Promise.all([
      ctx.db.supplier.findMany({ where: { deletedAt: null }, select: { id: true, name: true, paymentTermsDays: true } }),
      ctx.db.supplierBill.findMany({ where: { supplierRef: { not: null }, status: { not: "CANCELLED" } }, select: { supplierId: true, supplierRef: true } }),
    ]);
    return { parties: byName(rows.map((r) => ({ id: r.id, name: r.name, terms: r.paymentTermsDays }))), refs: new Set(bills.map((b) => `${b.supplierId}|${low(b.supplierRef!)}`)) };
  },
  prepare: (_ctx, v, lk) => prepareOpening("bill", v, lk),
  exists: (lk, p) => lk.refs.has(p.identity),
  create: (ctx, input) => createOpeningBill(ctx, input),
};

// ═══ Plan comptable ═══════════════════════════════════════════

const LEDGER_FIELDS: FieldDef[] = [
  { key: "code", label: "N° de compte", required: true, aliases: ["compte", "numerodecompte", "numcompte", "codecompte", "account", "accountcode", "numero", "code"] },
  { key: "name", label: "Intitulé du compte", required: true, aliases: ["intitule", "libelle", "designation", "nom", "accountname", "name", "libelledecompte", "intituledecompte"] },
];

const ledgerDef: EntityDef = {
  key: "ledger", label: "Plan comptable", module: "accounting", permission: "accounting.chart.manage", fields: LEDGER_FIELDS,
  note: "Le plan par défaut est conservé : les comptes déjà présents sont ignorés, les autres sont ajoutés. Les codes comptent 3 à 8 chiffres (classes 1 à 8).",
  sample: ["411100", "Clients — ventes de marchandises"],
  async loadLookups(ctx) {
    // le plan par défaut est posé d'abord : les comptes utilisés par les écritures automatiques (411, 401, 701…) doivent exister
    await accounting.ensureChart(ctx);
    const rows = await ctx.db.ledgerAccount.findMany({ select: { code: true } });
    return { codes: new Set(rows.map((r) => r.code)) };
  },
  prepare(_ctx, v) {
    const errors: string[] = [];
    const raw = { code: (v.code ?? "").replace(/[\s.]/g, ""), name: v.name ?? "" };
    const r = ledgerAccountSchema.safeParse(raw);
    if (!r.success) errors.push(...zodErrors(r.error, labelsOf(LEDGER_FIELDS)));
    return { input: r.success ? r.data : undefined, errors, identity: `c:${raw.code}` };
  },
  exists: (lk, p) => lk.codes.has(p.identity.slice(2)),
  create: (ctx, input) => accounting.createLedgerAccount(ctx, input),
};

// ═══ Écritures comptables et balance d'ouverture ══════════════

const ENTRY_FIELDS: FieldDef[] = [
  { key: "piece", label: "N° de pièce", required: true, hint: "Les lignes de même pièce forment une écriture.", aliases: ["piece", "numeropiece", "numdepiece", "npiece", "ndepiece", "numeroecriture", "ecriture", "entryno", "entrynumber", "journalentry", "move", "reference", "ref"] },
  { key: "date", label: "Date", required: true, aliases: ["date", "dateecriture", "datepiece", "dateoperation", "entrydate", "accountingdate"] },
  { key: "journal", label: "Code journal", hint: "Par défaut : journal des opérations diverses (OD).", aliases: ["journal", "codejournal", "jnl", "journalcode", "journalname"] },
  { key: "account", label: "N° de compte", required: true, aliases: ["compte", "numerodecompte", "numcompte", "codecompte", "account", "accountcode", "comptegeneral", "generalaccount"] },
  { key: "description", label: "Libellé de la pièce", aliases: ["libellepiece", "libelledelapiece", "description", "objet", "narration", "memo"] },
  { key: "label", label: "Libellé de la ligne", aliases: ["libelle", "libelleecriture", "label", "name", "intitule", "designation"] },
  { key: "debit", label: "Débit", aliases: ["debit", "debits", "montantdebit", "dr", "debitamount"] },
  { key: "credit", label: "Crédit", aliases: ["credit", "credits", "montantcredit", "cr", "creditamount"] },
];

interface EntryLine { journalId: string; date: string; reference: string; description: string; line: { ledgerAccountId: string; label: string; debit: number; credit: number } }

const entriesDef: EntityDef = {
  key: "entries", label: "Écritures comptables et balance d'ouverture", module: "accounting", permission: "accounting.entry.create", fields: ENTRY_FIELDS,
  note: "Importez d'abord le plan comptable. Les lignes de même N° de pièce forment une écriture, qui doit être équilibrée ; elle est validée à l'import (immuable, contre-passation possible). Pour une balance d'ouverture, mettez toutes les lignes sous une même pièce, au journal OD.",
  sample: ["BAL-OUV", "01/01/2026", "OD", "411100", "Balance d'ouverture", "Clients", "1180000", "0"],
  async loadLookups(ctx) {
    await accounting.ensureChart(ctx);
    const [accounts, journals, entries] = await Promise.all([
      ctx.db.ledgerAccount.findMany({ select: { id: true, code: true, isActive: true } }),
      ctx.db.journal.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, type: true } }),
      ctx.db.journalEntry.findMany({ where: { reference: { not: null } }, select: { reference: true, date: true } }),
    ]);
    const jmap = new Map<string, (typeof journals)[number]>();
    for (const j of journals) { jmap.set(key(j.code), j); jmap.set(key(j.name), j); }
    return {
      accounts: new Map(accounts.map((a) => [a.code, a])), journals: jmap, misc: journals.find((j) => j.type === "MISC"),
      pieces: new Set(entries.map((e) => `${low(e.reference!)}|${e.date.toISOString().slice(0, 10)}`)),
    };
  },
  prepare(_ctx, v, lk) {
    const errors: string[] = [];
    const piece = (v.piece ?? "").trim();
    if (!piece) errors.push("N° de pièce : valeur requise.");
    const dt = date(v.date ?? "", "Date", errors);
    if (!v.date) errors.push("Date : valeur requise.");
    const jraw = (v.journal ?? "").trim();
    const journal = jraw ? lk.journals.get(key(jraw)) : lk.misc;
    if (!journal) errors.push(jraw ? `Journal « ${jraw} » introuvable (code ou nom d'un journal actif).` : "Journal des opérations diverses introuvable : précisez le code journal.");
    else if (journal.type === "OPENING") errors.push(`Journal « ${journal.code} » : le journal des à-nouveaux est alimenté par la clôture ; utilisez le journal des opérations diverses (OD).`);
    const code = (v.account ?? "").replace(/[\s.]/g, "");
    const account = code ? lk.accounts.get(code) : undefined;
    if (!code) errors.push("N° de compte : valeur requise.");
    else if (!account) errors.push(`Compte « ${v.account} » introuvable : importez d'abord le plan comptable.`);
    else if (!account.isActive) errors.push(`Compte « ${code} » : désactivé.`);
    const debit = num(v.debit ?? "", "Débit", errors, { def: 0 });
    const credit = num(v.credit ?? "", "Crédit", errors, { def: 0 });
    if (typeof debit === "number" && typeof credit === "number") {
      if (debit < 0 || credit < 0) errors.push("Débit / Crédit : des montants positifs sont attendus.");
      else if (debit > 0 && credit > 0) errors.push("Une ligne est au débit ou au crédit, pas les deux.");
      else if (debit === 0 && credit === 0) errors.push("Débit ou Crédit : un montant est requis.");
    }
    const description = (v.description ?? "").trim() || `Reprise — pièce ${piece}`;
    const group = `${low(piece)}|${dt}|${jraw.toLowerCase()}`;
    if (errors.length > 0 || !journal || !account || typeof debit !== "number" || typeof credit !== "number") return { errors, identity: `${low(piece)}|${dt}`, group };
    const input: EntryLine = { journalId: journal.id, date: dt, reference: piece, description, line: { ledgerAccountId: account.id, label: (v.label ?? "").trim() || description, debit, credit } };
    return { input, errors, identity: `${low(piece)}|${dt}`, group };
  },
  exists: (lk, p) => lk.pieces.has(p.identity),
  group: {
    check(inputs: EntryLine[]) {
      const ref = inputs[0]!.reference;
      if (inputs.length < 2) return `Pièce « ${ref} » : au moins deux lignes sont nécessaires.`;
      const debit = inputs.reduce((a, i) => a.plus(i.line.debit), d(0));
      const credit = inputs.reduce((a, i) => a.plus(i.line.credit), d(0));
      return debit.eq(credit) ? null : `Pièce « ${ref} » déséquilibrée : débit ${debit.toString()} ≠ crédit ${credit.toString()}.`;
    },
    async create(ctx, inputs: EntryLine[]) {
      const first = inputs[0]!;
      const entry = await accounting.createManualEntry(ctx, { journalId: first.journalId, date: first.date, reference: first.reference, description: first.description, lines: inputs.map((i) => i.line) });
      try {
        await accounting.validateManualEntry(ctx, entry.id);
      } catch (e) {
        await accounting.deleteManualEntry(ctx, entry.id); // pas de brouillon oublié : la pièce est signalée en erreur (exercice clôturé, période verrouillée…)
        throw e;
      }
    },
  },
};

export const ENTITIES: Record<ImportEntity, EntityDef> = {
  customers, suppliers: suppliersDef, employees: employeesDef, products: productsDef, stock: stockDef,
  invoices: invoicesDef, bills: billsDef, ledger: ledgerDef, entries: entriesDef,
};

/** Importable par cet utilisateur : module actif + droit d'import + droit de création de l'entité. */
export const canImport = (ctx: Pick<Ctx, "can" | "hasModule">, e: Pick<EntityDef, "module" | "permission">) =>
  ctx.hasModule(e.module) && ctx.can("data.import.manage") && ctx.can(e.permission);

/** Champs proposés à cet utilisateur (les champs sensibles exigent le droit « salaires »). */
export const fieldsFor = (ctx: Ctx, e: EntityDef) => e.fields.filter((f) => !f.sensitive || e.key !== "employees" || canSeePay(ctx));

/** Correspondance automatique : chaque champ reçoit la colonne dont l'intitulé est reconnu (une colonne n'est utilisée qu'une fois). */
export function suggestMapping(headers: string[], fields: FieldDef[], extra: Record<string, string[]> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  const used = new Set<number>();
  const norm = headers.map(normHeader);
  for (const f of fields) {
    const wanted = [normHeader(f.label), normHeader(f.key), ...(extra[f.key] ?? []), ...f.aliases];
    const i = norm.findIndex((h, idx) => !used.has(idx) && h !== "" && wanted.includes(h));
    if (i >= 0) { out[f.key] = i; used.add(i); }
  }
  return out;
}
