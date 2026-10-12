import "server-only";
import { z } from "zod";
import { audit } from "@/core/audit";
import { businessRule, notFound } from "@/core/errors";
import { roundMoney } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";

/**
 * Listes de prix : un tarif par produit, affecté à des clients (grossiste, revendeur, contrat-cadre…). À la saisie d'un devis, d'une
 * commande ou d'une facture, le prix proposé pour un produit est celui de la liste du client, à défaut le prix de vente standard.
 * Le prix reste modifiable ligne par ligne : la liste est une proposition, jamais une contrainte.
 */
type Ctx = TenantContext;

const uuid = z.string().uuid();
export const priceListSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(100),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});
export const updatePriceListSchema = priceListSchema.extend({ id: uuid });
export const priceListItemsSchema = z.object({
  id: uuid,
  items: z.array(z.object({ productId: uuid, price: z.coerce.number().min(0, "Prix ≥ 0").max(1e13) })).max(5000),
});

const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);

export async function listPriceLists(ctx: Ctx) {
  return ctx.db.priceList.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { items: true, customers: true } } }, take: 200 });
}

export async function getPriceList(ctx: Ctx, id: string) {
  const l = await ctx.db.priceList.findFirst({ where: { id }, include: { items: { include: { product: { select: { id: true, name: true, sku: true, unit: true, salePrice: true } } }, orderBy: { product: { name: "asc" } } }, customers: { where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 } } });
  if (!l) throw notFound("Liste de prix");
  return l;
}

export async function createPriceList(ctx: Ctx, input: z.output<typeof priceListSchema>) {
  if (await ctx.db.priceList.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } }, select: { id: true } })) throw businessRule("Une liste porte déjà ce nom.");
  const l = await ctx.db.priceList.create({ data: { companyId: ctx.company.id, name: input.name, description: blank(input.description), isActive: input.isActive, createdById: ctx.user.id } });
  await audit(ctx, { action: "price_list.create", resource: "PriceList", resourceId: l.id, summary: `${ctx.user.name} a créé la liste de prix « ${l.name} ».` });
  return l;
}

export async function updatePriceList(ctx: Ctx, input: z.output<typeof updatePriceListSchema>) {
  const before = await getPriceList(ctx, input.id);
  const clash = await ctx.db.priceList.findFirst({ where: { id: { not: input.id }, name: { equals: input.name, mode: "insensitive" } }, select: { id: true } });
  if (clash) throw businessRule("Une liste porte déjà ce nom.");
  const l = await ctx.db.priceList.update({ where: { id: input.id }, data: { name: input.name, description: blank(input.description), isActive: input.isActive } });
  await audit(ctx, { action: "price_list.update", resource: "PriceList", resourceId: l.id, summary: `${ctx.user.name} a modifié la liste de prix « ${before.name} ».` });
  return l;
}

/** Remplace tous les prix de la liste. Chaque produit doit appartenir à l'entreprise ; un produit ne figure qu'une fois. */
export async function setPriceListItems(ctx: Ctx, input: z.output<typeof priceListItemsSchema>) {
  const list = await getPriceList(ctx, input.id);
  const ids = input.items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) throw businessRule("Un produit ne peut figurer qu'une fois dans la liste.");
  if (ids.length) {
    const found = await ctx.db.product.count({ where: { id: { in: ids }, deletedAt: null } });
    if (found !== ids.length) throw notFound("Produit");
  }
  await ctx.tx(async (tx) => {
    await tx.priceListItem.deleteMany({ where: { priceListId: list.id } });
    if (input.items.length) await tx.priceListItem.createMany({ data: input.items.map((i) => ({ companyId: ctx.company.id, priceListId: list.id, productId: i.productId, price: roundMoney(i.price, ctx.company.currency).toString() })) });
  });
  await audit(ctx, { action: "price_list.items", resource: "PriceList", resourceId: list.id, summary: `${ctx.user.name} a mis à jour les prix de la liste « ${list.name} » (${input.items.length} produit${input.items.length > 1 ? "s" : ""}).` });
}

export async function deletePriceList(ctx: Ctx, id: string) {
  const list = await getPriceList(ctx, id);
  await ctx.db.priceList.delete({ where: { id } }); // les clients concernés repassent au prix standard (lien mis à vide)
  await audit(ctx, { action: "price_list.delete", resource: "PriceList", resourceId: id, summary: `${ctx.user.name} a supprimé la liste de prix « ${list.name} » (${list.customers.length} client${list.customers.length > 1 ? "s" : ""} repassent au prix standard).` });
}

