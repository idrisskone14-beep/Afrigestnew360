import "server-only";
import type { TenantContext } from "@/core/tenant/context";
import { listDocuments } from "@/modules/documents/service";

type Ctx = TenantContext;
export interface SearchItem { id: string; label: string; sub?: string; href: string }
export interface SearchGroup { type: string; label: string; items: SearchItem[] }

export const SEARCH_MIN = 2;
export const SEARCH_PER_GROUP = 5;

const ci = (q: string) => ({ contains: q, mode: "insensitive" as const });

interface Source {
  type: string;
  label: string;
  /** Module requis (actif) et permission de lecture : un type non autorisé n'est jamais interrogé. */
  module: string;
  permission: string;
  run: (ctx: Ctx, q: string) => Promise<SearchItem[]>;
}

const take = SEARCH_PER_GROUP;

const SOURCES: Source[] = [
  { type: "customer", label: "Clients", module: "crm", permission: "crm.customer.read", async run(ctx, q) {
    const rows = await ctx.db.customer.findMany({ where: { deletedAt: null, OR: [{ name: ci(q) }, { code: ci(q) }, { email: ci(q) }, { phone: ci(q) }] }, orderBy: { name: "asc" }, take, select: { id: true, name: true, code: true, city: true } });
    return rows.map((r) => ({ id: r.id, label: r.name, sub: [r.code, r.city].filter(Boolean).join(" · "), href: `/app/crm/clients/${r.id}` }));
  } },
  { type: "supplier", label: "Fournisseurs", module: "purchases", permission: "purchases.supplier.read", async run(ctx, q) {
    const rows = await ctx.db.supplier.findMany({ where: { deletedAt: null, OR: [{ name: ci(q) }, { code: ci(q) }, { email: ci(q) }, { phone: ci(q) }] }, orderBy: { name: "asc" }, take, select: { id: true, name: true, code: true, city: true } });
    return rows.map((r) => ({ id: r.id, label: r.name, sub: [r.code, r.city].filter(Boolean).join(" · "), href: `/app/purchases/fournisseurs/${r.id}` }));
  } },
  { type: "invoice", label: "Factures", module: "sales", permission: "finance.invoice.read", async run(ctx, q) {
    const rows = await ctx.db.invoice.findMany({ where: { OR: [{ number: ci(q) }, { customer: { name: ci(q) } }] }, orderBy: { createdAt: "desc" }, take, select: { id: true, number: true, status: true, customer: { select: { name: true } } } });
    return rows.map((r) => ({ id: r.id, label: r.number ?? "Brouillon", sub: r.customer?.name, href: `/app/sales/factures/${r.id}` }));
  } },
  { type: "quote", label: "Devis", module: "sales", permission: "sales.quote.read", async run(ctx, q) {
    const rows = await ctx.db.quote.findMany({ where: { OR: [{ number: ci(q) }, { customer: { name: ci(q) } }] }, orderBy: { createdAt: "desc" }, take, select: { id: true, number: true, customer: { select: { name: true } } } });
    return rows.map((r) => ({ id: r.id, label: r.number, sub: r.customer?.name, href: `/app/sales/devis/${r.id}` }));
  } },
  { type: "employee", label: "Salariés", module: "hr", permission: "hr.employee.read", async run(ctx, q) {
    const rows = await ctx.db.employee.findMany({ where: { deletedAt: null, OR: [{ firstName: ci(q) }, { lastName: ci(q) }, { number: ci(q) }, { email: ci(q) }] }, orderBy: { lastName: "asc" }, take, select: { id: true, firstName: true, lastName: true, number: true, jobTitle: true } });
    return rows.map((r) => ({ id: r.id, label: `${r.lastName} ${r.firstName}`, sub: [r.number, r.jobTitle].filter(Boolean).join(" · "), href: `/app/hr/salaries/${r.id}` }));
  } },
  { type: "product", label: "Produits", module: "inventory", permission: "inventory.product.read", async run(ctx, q) {
    const rows = await ctx.db.product.findMany({ where: { deletedAt: null, OR: [{ name: ci(q) }, { sku: ci(q) }, { barcode: ci(q) }] }, orderBy: { name: "asc" }, take, select: { id: true, name: true, sku: true } });
    return rows.map((r) => ({ id: r.id, label: r.name, sub: r.sku, href: `/app/inventory/produits/${r.id}` }));
  } },
  { type: "project", label: "Projets", module: "projects", permission: "project.project.read", async run(ctx, q) {
    const rows = await ctx.db.project.findMany({ where: { deletedAt: null, OR: [{ name: ci(q) }, { code: ci(q) }] }, orderBy: { createdAt: "desc" }, take, select: { id: true, name: true, code: true } });
    return rows.map((r) => ({ id: r.id, label: r.name, sub: r.code, href: `/app/projects/projets/${r.id}` }));
  } },
  { type: "vehicle", label: "Véhicules", module: "fleet", permission: "fleet.vehicle.read", async run(ctx, q) {
    const rows = await ctx.db.vehicle.findMany({ where: { deletedAt: null, OR: [{ plate: ci(q.replace(/\s+/g, "-")) }, { plate: ci(q) }, { name: ci(q) }, { brand: ci(q) }, { model: ci(q) }, { vin: ci(q) }] }, orderBy: { plate: "asc" }, take, select: { id: true, plate: true, brand: true, model: true, name: true } });
    return rows.map((r) => ({ id: r.id, label: r.plate, sub: [r.name, r.brand, r.model].filter(Boolean).join(" · "), href: `/app/fleet/vehicules/${r.id}` }));
  } },
  { type: "site", label: "Chantiers", module: "construction", permission: "construction.site.read", async run(ctx, q) {
    const rows = await ctx.db.constructionSite.findMany({ where: { deletedAt: null, OR: [{ name: ci(q) }, { code: ci(q) }, { city: ci(q) }] }, orderBy: { code: "desc" }, take, select: { id: true, code: true, name: true, city: true } });
    return rows.map((r) => ({ id: r.id, label: `${r.code} — ${r.name}`, sub: r.city ?? undefined, href: `/app/construction/chantiers/${r.id}` }));
  } },
  // Les documents passent par le service de la GED : visibilité, partages et droits sur les entités liées y sont appliqués en base
  { type: "document", label: "Documents", module: "documents", permission: "documents.document.read", async run(ctx, q) {
    const { rows } = await listDocuments(ctx, { q, skip: 0, take });
    return rows.map((r) => ({ id: r.id, label: r.name, sub: r.folder?.name ?? "Racine", href: `/app/documents/${r.id}` }));
  } },
];

/** Types de recherche actuellement disponibles pour cet utilisateur (module actif + droit de lecture). */
export const searchableTypes = (ctx: Pick<Ctx, "hasModule" | "can">) => SOURCES.filter((s) => ctx.hasModule(s.module) && ctx.can(s.permission)).map((s) => ({ type: s.type, label: s.label }));

/**
 * Recherche globale : interroge uniquement les types que l'utilisateur peut lire, dans SON entreprise
 * (ctx.db), avec au plus 5 résultats par type. Les véhicules s'y ajouteront avec le module Flotte (phase 6).
 */
export async function globalSearch(ctx: Ctx, raw: string): Promise<SearchGroup[]> {
  const q = raw.trim().slice(0, 100);
  if (q.length < SEARCH_MIN) return [];
  const sources = SOURCES.filter((s) => ctx.hasModule(s.module) && ctx.can(s.permission));
  const groups = await Promise.all(sources.map(async (s) => ({ type: s.type, label: s.label, items: await s.run(ctx, q) })));
  return groups.filter((g) => g.items.length > 0);
}
