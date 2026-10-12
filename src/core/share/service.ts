import "server-only";
import { randomBytes } from "node:crypto";
import { platformDb } from "@/core/db/client";
import { appUrl } from "@/core/mail";
import { buildAccess } from "@/core/rbac/access";
import { createTenantContext, type TenantContext } from "@/core/tenant/ctx-factory";

/**
 * Liens publics : un secret aléatoire (192 bits) donne accès en lecture à UN document (devis ou facture) sans compte.
 * Le lien est révocable ; il n'ouvre rien d'autre que ce document (et, pour un devis, la réponse du client).
 * La recherche par secret traverse les entreprises : elle passe par `platformDb` (seul endroit autorisé pour cela),
 * puis tout le reste s'exécute dans le contexte isolé de l'entreprise propriétaire du document.
 */
export type ShareDocType = "QUOTE" | "INVOICE";

const NIL_USER = "00000000-0000-0000-0000-000000000000";

export const newShareToken = () => randomBytes(24).toString("base64url");
export const shareUrl = (token: string) => appUrl(`/p/${token}`);
/** Un secret valide = 32 caractères base64url ; tout le reste est refusé avant d'interroger la base. */
export const isShareToken = (v: string) => /^[A-Za-z0-9_-]{32}$/.test(v);

/** Lien existant (non révoqué) du document, ou nouveau lien. Appelé par un utilisateur de l'entreprise (contexte isolé). */
export async function ensureShareLink(ctx: Pick<TenantContext, "db" | "company" | "user">, docType: ShareDocType, docId: string): Promise<{ token: string; url: string }> {
  const existing = await ctx.db.shareLink.findFirst({ where: { docType, docId } });
  if (existing && !existing.revokedAt) return { token: existing.token, url: shareUrl(existing.token) };
  if (existing) {
    // lien révoqué : on en fournit un nouveau (l'ancien reste inutilisable)
    const token = newShareToken();
    await ctx.db.shareLink.update({ where: { id: existing.id }, data: { token, revokedAt: null, viewCount: 0, lastViewedAt: null } });
    return { token, url: shareUrl(token) };
  }
  const token = newShareToken();
  await ctx.db.shareLink.create({ data: { companyId: ctx.company.id, docType, docId, token, createdById: ctx.user.id } });
  return { token, url: shareUrl(token) };
}

export async function revokeShareLink(ctx: Pick<TenantContext, "db">, docType: ShareDocType, docId: string) {
  await ctx.db.shareLink.updateMany({ where: { docType, docId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export interface ResolvedShare { id: string; companyId: string; docType: ShareDocType; docId: string }

/** Résout un secret en document ; null si inconnu, révoqué ou d'une entreprise suspendue. */
export async function resolveShare(token: string): Promise<ResolvedShare | null> {
  if (!isShareToken(token)) return null;
  const link = await platformDb.shareLink.findUnique({ where: { token }, include: { company: { select: { status: true, deletedAt: true } } } });
  if (!link || link.revokedAt || link.company.deletedAt || link.company.status !== "ACTIVE") return null;
  return { id: link.id, companyId: link.companyId, docType: link.docType, docId: link.docId };
}

export async function recordShareView(id: string) {
  await platformDb.shareLink.update({ where: { id }, data: { viewCount: { increment: 1 }, lastViewedAt: new Date() } });
}

/**
 * Contexte « public » d'une entreprise : sans utilisateur ni droit (`can` renvoie toujours faux), uniquement pour lire un document
 * partagé et enregistrer la réponse du client. Les écritures y sont faites par des fonctions dédiées, jamais par les actions internes.
 */
export async function publicContext(companyId: string): Promise<TenantContext | null> {
  const c = await platformDb.company.findFirst({ where: { id: companyId, deletedAt: null, status: "ACTIVE" } });
  if (!c) return null;
  return createTenantContext({
    user: { id: NIL_USER, name: "Client (lien public)", email: "", isPlatformAdmin: false, locale: "fr", twoFactorEnabled: false, emailVerified: true },
    sessionId: "public",
    company: { id: c.id, legalName: c.legalName, tradeName: c.tradeName, slug: c.slug, currency: c.currency, timezone: c.timezone, country: c.country, logoUrl: null },
    membership: { id: NIL_USER, roleId: NIL_USER, roleName: "Public", isOwner: false },
    access: buildAccess({ isAdmin: false, grantedKeys: [], enabledModules: ["sales"] }),
    switcher: [],
  });
}
