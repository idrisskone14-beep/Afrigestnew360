import "server-only";
import { audit } from "@/core/audit";
import { businessRule, notFound } from "@/core/errors";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import type { z } from "zod";
import type { supplierSchema, updateSupplierSchema } from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);

export async function listSuppliers(ctx: Ctx, p: { q?: string; active?: boolean; skip: number; take: number }) {
  const where = {
    deletedAt: null,
    ...(p.active === undefined ? {} : { isActive: p.active }),
    ...(p.q ? { OR: ["name", "code", "email", "phone", "city"].map((f) => ({ [f]: { contains: p.q, mode: "insensitive" as const } })) } : {}),
  };
  const [total, rows] = await Promise.all([
    ctx.db.supplier.count({ where }),
    ctx.db.supplier.findMany({ where, orderBy: { name: "asc" }, skip: p.skip, take: p.take }),
  ]);
  return { total, rows };
}

export async function getSupplier(ctx: Ctx, id: string) {
  const s = await ctx.db.supplier.findFirst({ where: { id, deletedAt: null }, include: { contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] } } });
  if (!s) throw notFound("Fournisseur");
  return s;
}

export async function createSupplier(ctx: Ctx, input: z.output<typeof supplierSchema>) {
  const supplier = await ctx.tx(async (tx) => {
    const code = await nextNumber(tx, ctx.company.id, "supplier");
    return tx.supplier.create({
      data: {
        companyId: ctx.company.id, code, name: input.name, email: blank(input.email), phone: blank(input.phone), address: blank(input.address), city: blank(input.city), country: blank(input.country),
        taxId: blank(input.taxId), rccm: blank(input.rccm), paymentTermsDays: input.paymentTermsDays, notes: blank(input.notes), createdById: ctx.user.id,
      },
    });
  });
  await audit(ctx, { action: "supplier.create", resource: "Supplier", resourceId: supplier.id, summary: `${ctx.user.name} a créé le fournisseur ${supplier.name} (${supplier.code}).`, after: supplier });
  return supplier;
}

export async function updateSupplier(ctx: Ctx, input: z.output<typeof updateSupplierSchema>) {
  const before = await getSupplier(ctx, input.id);
  const after = await ctx.db.supplier.update({
    where: { id: input.id },
    data: { name: input.name, email: blank(input.email), phone: blank(input.phone), address: blank(input.address), city: blank(input.city), country: blank(input.country), taxId: blank(input.taxId), rccm: blank(input.rccm), paymentTermsDays: input.paymentTermsDays, notes: blank(input.notes), isActive: input.isActive },
  });
  await audit(ctx, { action: "supplier.update", resource: "Supplier", resourceId: after.id, summary: `${ctx.user.name} a modifié le fournisseur ${after.name}.`, before, after });
  return after;
}

/** Archive un fournisseur ; refusé s'il reste une dette (facture non soldée). */
export async function archiveSupplier(ctx: Ctx, id: string) {
  const s = await getSupplier(ctx, id);
  const open = await ctx.db.supplierBill.count({ where: { supplierId: id, status: { in: ["POSTED", "PARTIALLY_PAID"] } } });
  if (open > 0) throw businessRule("Ce fournisseur a des factures non soldées : réglez-les avant de l'archiver.");
  await ctx.db.supplier.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await audit(ctx, { action: "supplier.delete", resource: "Supplier", resourceId: id, summary: `${ctx.user.name} a archivé le fournisseur ${s.name}.`, before: s });
}
