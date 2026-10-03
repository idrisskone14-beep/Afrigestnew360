import "server-only";
import { z } from "zod";
import type { TenantContext } from "@/core/tenant/context";
import { COUNTRIES } from "@/lib/reference-data";
import { customerSchema } from "@/modules/crm/schemas";
import * as crm from "@/modules/crm/service";
import { canSeePay } from "@/modules/hr/employees";
import * as hrEmployees from "@/modules/hr/employees";
import { employeeSchema } from "@/modules/hr/schemas";
import { movementSchema, productSchema } from "@/modules/inventory/schemas";
import * as inventory from "@/modules/inventory/service";
import { supplierSchema } from "@/modules/purchasing/schemas";
import * as suppliers from "@/modules/purchasing/suppliers";
import { normHeader, parseBool, parseDateText, parseNumber } from "./parse";

type Ctx = TenantContext;
export const IMPORT_ENTITIES = ["customers", "suppliers", "employees", "products", "stock"] as const;
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

export interface Prepared { input?: unknown; errors: string[]; identity: string }
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
  loadLookups: (ctx: Ctx) => Promise<Lookups>;
  prepare: (ctx: Ctx, v: Values, lk: Lookups) => Prepared;
  /** Déjà présent en base ? (ignoré à l'import : un même fichier peut être rejoué sans doublon) */
  exists: (lk: Lookups, p: Prepared) => boolean;
  create: (ctx: Ctx, input: never) => Promise<unknown>;
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

export const ENTITIES: Record<ImportEntity, EntityDef> = { customers, suppliers: suppliersDef, employees: employeesDef, products: productsDef, stock: stockDef };

/** Importable par cet utilisateur : module actif + droit d'import + droit de création de l'entité. */
export const canImport = (ctx: Pick<Ctx, "can" | "hasModule">, e: Pick<EntityDef, "module" | "permission">) =>
  ctx.hasModule(e.module) && ctx.can("data.import.manage") && ctx.can(e.permission);

/** Champs proposés à cet utilisateur (les champs sensibles exigent le droit « salaires »). */
export const fieldsFor = (ctx: Ctx, e: EntityDef) => e.fields.filter((f) => !f.sensitive || e.key !== "employees" || canSeePay(ctx));

/** Correspondance automatique : chaque champ reçoit la colonne dont l'intitulé est reconnu (une colonne n'est utilisée qu'une fois). */
export function suggestMapping(headers: string[], fields: FieldDef[]): Record<string, number> {
  const out: Record<string, number> = {};
  const used = new Set<number>();
  const norm = headers.map(normHeader);
  for (const f of fields) {
    const wanted = [normHeader(f.label), normHeader(f.key), ...f.aliases];
    const i = norm.findIndex((h, idx) => !used.has(idx) && h !== "" && wanted.includes(h));
    if (i >= 0) { out[f.key] = i; used.add(i); }
  }
  return out;
}
