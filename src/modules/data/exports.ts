import "server-only";
import type { ExportTable } from "@/core/export/table";
import { notFound } from "@/core/errors";
import { d } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import { countryName } from "@/lib/reference-data";
import { parseAuditFilters } from "@/modules/audit/params";
import { auditForExport, AUDIT_EXPORT_MAX } from "@/modules/audit/service";
import { canSeePay } from "@/modules/hr/employees";
import { ENTITIES, IMPORT_ENTITIES, fieldsFor } from "./entities";
import { importReport } from "./import-service";

type Ctx = TenantContext;
type Q = (key: string) => string | undefined;

export interface Exporter {
  /** Module requis (actif) et permissions (toutes requises) : vérifiés par la route, jamais par le client. */
  module?: string;
  permissions: string[];
  build: (ctx: Ctx, q: Q) => Promise<ExportTable>;
}

const MAX_ROWS = 20_000;
const base = (ctx: Ctx) => ({ company: ctx.company.tradeName ?? ctx.company.legalName, currency: ctx.company.currency, generatedAt: new Date() });
const day = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : "");
const status = (active: boolean) => (active ? "Actif" : "Inactif");

export const EXPORTERS: Record<string, Exporter> = {
  audit: {
    permissions: ["audit.log.read"],
    async build(ctx, q) {
      const rows = await auditForExport(ctx, parseAuditFilters(q));
      return {
        ...base(ctx), title: "Journal d'audit", subtitle: rows.length >= AUDIT_EXPORT_MAX ? `limité aux ${AUDIT_EXPORT_MAX} entrées les plus récentes` : undefined,
        columns: [
          { key: "date", label: "Date", width: 14 }, { key: "user", label: "Utilisateur", width: 16 }, { key: "action", label: "Action", width: 16 }, { key: "resource", label: "Ressource", width: 12 },
          { key: "resourceId", label: "Identifiant", width: 18 }, { key: "summary", label: "Résumé", width: 40 }, { key: "ip", label: "IP", width: 10 },
        ],
        rows: rows.map((r) => ({ date: r.createdAt.toISOString().replace("T", " ").slice(0, 19), user: r.userLabel ?? "Système", action: r.action, resource: r.resource, resourceId: r.resourceId, summary: r.summary, ip: r.ip })),
      };
    },
  },

  clients: {
    module: "crm", permissions: ["data.export.run", "crm.customer.read"],
    async build(ctx) {
      const rows = await ctx.db.customer.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, take: MAX_ROWS });
      return {
        ...base(ctx), title: "Clients",
        columns: [{ key: "code", label: "Code", width: 10 }, { key: "name", label: "Nom", width: 28 }, { key: "type", label: "Type", width: 10 }, { key: "email", label: "E-mail", width: 24 }, { key: "phone", label: "Téléphone", width: 16 }, { key: "city", label: "Ville", width: 14 }, { key: "country", label: "Pays", width: 14 }, { key: "taxId", label: "Identifiant fiscal", width: 16 }, { key: "terms", label: "Délai (j)", type: "number", width: 8 }, { key: "credit", label: "Plafond de crédit", type: "money" }, { key: "status", label: "Statut", width: 9 }],
        rows: rows.map((r) => ({ code: r.code, name: r.name, type: r.type === "COMPANY" ? "Entreprise" : "Particulier", email: r.email, phone: r.phone, city: r.city, country: r.country ? countryName(r.country) : "", taxId: r.taxId, terms: r.paymentTermsDays, credit: r.creditLimit ? d(r.creditLimit).toNumber() : null, status: status(r.isActive) })),
      };
    },
  },

  fournisseurs: {
    module: "purchases", permissions: ["data.export.run", "purchases.supplier.read"],
    async build(ctx) {
      const rows = await ctx.db.supplier.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, take: MAX_ROWS });
      return {
        ...base(ctx), title: "Fournisseurs",
        columns: [{ key: "code", label: "Code", width: 10 }, { key: "name", label: "Nom", width: 28 }, { key: "email", label: "E-mail", width: 24 }, { key: "phone", label: "Téléphone", width: 16 }, { key: "city", label: "Ville", width: 14 }, { key: "country", label: "Pays", width: 14 }, { key: "taxId", label: "Identifiant fiscal", width: 16 }, { key: "terms", label: "Délai (j)", type: "number", width: 8 }, { key: "status", label: "Statut", width: 9 }],
        rows: rows.map((r) => ({ code: r.code, name: r.name, email: r.email, phone: r.phone, city: r.city, country: r.country ? countryName(r.country) : "", taxId: r.taxId, terms: r.paymentTermsDays, status: status(r.isActive) })),
      };
    },
  },

  produits: {
    module: "inventory", permissions: ["data.export.run", "inventory.product.read"],
    async build(ctx) {
      const rows = await ctx.db.product.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, take: MAX_ROWS, include: { category: { select: { name: true } } } });
      return {
        ...base(ctx), title: "Produits et services",
        columns: [{ key: "sku", label: "Référence", width: 12 }, { key: "name", label: "Désignation", width: 30 }, { key: "type", label: "Type", width: 9 }, { key: "category", label: "Catégorie", width: 16 }, { key: "unit", label: "Unité", width: 8 }, { key: "sale", label: "Prix de vente", type: "money" }, { key: "cost", label: "Coût d'achat", type: "money" }, { key: "min", label: "Seuil", type: "number", width: 8 }, { key: "track", label: "Suivi stock", width: 10 }, { key: "status", label: "Statut", width: 9 }],
        rows: rows.map((r) => ({ sku: r.sku, name: r.name, type: r.type === "GOODS" ? "Bien" : "Service", category: r.category?.name ?? "", unit: r.unit, sale: d(r.salePrice).toNumber(), cost: d(r.costPrice).toNumber(), min: d(r.minStock).toNumber(), track: r.trackStock ? "Oui" : "Non", status: status(r.isActive) })),
      };
    },
  },

  stock: {
    module: "inventory", permissions: ["data.export.run", "inventory.stock.read"],
    async build(ctx) {
      const levels = await ctx.db.stockLevel.findMany({ take: MAX_ROWS, include: { product: { select: { sku: true, name: true, unit: true, costPrice: true, deletedAt: true } }, warehouse: { select: { name: true } } } });
      const rows = levels.filter((l) => !l.product.deletedAt).sort((a, b) => a.product.name.localeCompare(b.product.name, "fr") || a.warehouse.name.localeCompare(b.warehouse.name, "fr"));
      return {
        ...base(ctx), title: "État des stocks",
        columns: [{ key: "sku", label: "Référence", width: 12 }, { key: "name", label: "Produit", width: 30 }, { key: "warehouse", label: "Entrepôt", width: 18 }, { key: "unit", label: "Unité", width: 8 }, { key: "qty", label: "Quantité", type: "number" }, { key: "reserved", label: "Réservé", type: "number" }, { key: "cost", label: "Coût moyen", type: "money" }, { key: "value", label: "Valeur", type: "money" }],
        rows: rows.map((l) => ({ sku: l.product.sku, name: l.product.name, warehouse: l.warehouse.name, unit: l.product.unit, qty: d(l.quantity).toNumber(), reserved: d(l.reserved).toNumber(), cost: d(l.product.costPrice).toNumber(), value: d(l.quantity).mul(l.product.costPrice).toDecimalPlaces(2).toNumber() })),
        totals: { value: rows.reduce((a, l) => a + d(l.quantity).mul(l.product.costPrice).toDecimalPlaces(2).toNumber(), 0) },
      };
    },
  },

  vehicules: {
    module: "fleet", permissions: ["data.export.run", "fleet.vehicle.read"],
    async build(ctx) {
      const rows = await ctx.db.vehicle.findMany({ where: { deletedAt: null }, orderBy: { plate: "asc" }, take: MAX_ROWS });
      const statuses: Record<string, string> = { ACTIVE: "En service", IN_MAINTENANCE: "En maintenance", OUT_OF_SERVICE: "Hors service", SOLD: "Vendu" };
      return {
        ...base(ctx), title: "Véhicules",
        columns: [{ key: "plate", label: "Immatriculation", width: 16 }, { key: "name", label: "Appellation", width: 18 }, { key: "type", label: "Type", width: 10 }, { key: "brand", label: "Marque", width: 12 }, { key: "model", label: "Modèle", width: 12 }, { key: "year", label: "Année", type: "number", width: 7 }, { key: "odometer", label: "Kilométrage", type: "number" }, { key: "status", label: "Statut", width: 13 }],
        rows: rows.map((r) => ({ plate: r.plate, name: r.name, type: r.type, brand: r.brand, model: r.model, year: r.year, odometer: r.odometer, status: statuses[r.status] ?? r.status })),
      };
    },
  },

  contraventions: {
    module: "fleet", permissions: ["data.export.run", "fleet.fine.read"],
    async build(ctx) {
      const rows = await ctx.db.trafficFine.findMany({ orderBy: { date: "desc" }, take: MAX_ROWS, include: { vehicle: { select: { plate: true } }, driver: { select: { fullName: true } } } });
      const statuses: Record<string, string> = { TO_PAY: "À payer", PAID: "Payée", CONTESTED: "Contestée", CANCELLED: "Annulée" };
      return {
        ...base(ctx), title: "Contraventions",
        columns: [{ key: "number", label: "PV", width: 14 }, { key: "date", label: "Date", type: "date", width: 11 }, { key: "vehicle", label: "Véhicule", width: 14 }, { key: "driver", label: "Chauffeur", width: 18 }, { key: "offence", label: "Infraction", width: 28 }, { key: "place", label: "Lieu", width: 18 }, { key: "amount", label: "Montant", type: "money" }, { key: "due", label: "Échéance", type: "date", width: 11 }, { key: "status", label: "Statut", width: 11 }],
        rows: rows.map((r) => ({ number: r.number, date: day(r.date), vehicle: r.vehicle.plate, driver: r.driver?.fullName ?? "", offence: r.offence, place: r.place, amount: d(r.amount).toNumber(), due: day(r.dueDate), status: statuses[r.status] ?? r.status })),
      };
    },
  },

  salaries: {
    module: "hr", permissions: ["data.export.run", "hr.employee.read"],
    async build(ctx) {
      const pay = canSeePay(ctx);
      const rows = await ctx.db.employee.findMany({ where: { deletedAt: null }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: MAX_ROWS, include: { department: { select: { name: true } }, branch: { select: { name: true } } } });
      const statuses: Record<string, string> = { ACTIVE: "En activité", ON_LEAVE: "En congé", SUSPENDED: "Suspendu", TERMINATED: "Sorti" };
      return {
        ...base(ctx), title: "Salariés",
        // salaires, pièce d'identité et coordonnées de paiement : jamais exportés sans le droit « contrats / paie »
        columns: [{ key: "number", label: "Matricule", width: 10 }, { key: "name", label: "Nom", width: 22 }, { key: "job", label: "Poste", width: 20 }, { key: "dept", label: "Département", width: 16 }, { key: "branch", label: "Agence", width: 14 }, { key: "hire", label: "Embauche", type: "date", width: 11 }, { key: "status", label: "Statut", width: 11 }, { key: "email", label: "E-mail", width: 24 }, { key: "phone", label: "Téléphone", width: 15 }, ...(pay ? [{ key: "salary", label: "Salaire de base", type: "money" as const }] : [])],
        rows: rows.map((r) => ({ number: r.number, name: `${r.lastName} ${r.firstName}`, job: r.jobTitle, dept: r.department?.name ?? "", branch: r.branch?.name ?? "", hire: day(r.hireDate), status: statuses[r.status] ?? r.status, email: r.email, phone: r.phone, ...(pay ? { salary: d(r.baseSalary).toNumber() } : {}) })),
      };
    },
  },

  // Rapport d'anomalies d'un import (ligne, résultat, message + valeurs d'origine pour corriger puis ré-importer)
  "import-rapport": {
    permissions: ["data.import.manage"],
    async build(ctx, q) {
      const id = q("job") ?? "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Import");
      const { job, entries, headers } = await importReport(ctx, id);
      return {
        ...base(ctx), title: `Rapport d'import — ${ENTITIES[job.entity as keyof typeof ENTITIES]?.label ?? job.entity}`, subtitle: job.fileName,
        columns: [{ key: "line", label: "Ligne", type: "number", width: 7 }, { key: "result", label: "Résultat", width: 10 }, { key: "message", label: "Message", width: 44 }, ...headers.map((h, i) => ({ key: `c${i}`, label: h || `Colonne ${i + 1}`, width: 16 }))],
        rows: entries.map((e) => ({ line: e.line, result: e.kind === "error" ? "Erreur" : "Ignorée", message: e.message, ...Object.fromEntries(e.values.map((v, i) => [`c${i}`, v])) })),
      };
    },
  },
};

// Modèles d'import téléchargeables : en-têtes reconnus automatiquement + une ligne d'exemple
for (const key of IMPORT_ENTITIES) {
  const def = ENTITIES[key];
  EXPORTERS[`modele-${key}`] = {
    module: def.module, permissions: ["data.import.manage", def.permission],
    async build(ctx) {
      const fields = fieldsFor(ctx, def);
      const index = new Map(def.fields.map((f, i) => [f.key, i]));
      return {
        ...base(ctx), title: `Modèle d'import — ${def.label}`,
        columns: fields.map((f) => ({ key: f.key, label: f.required ? `${f.label} *` : f.label, width: 20 })),
        rows: [Object.fromEntries(fields.map((f) => [f.key, def.sample[index.get(f.key)!] ?? ""]))],
      };
    },
  };
}
