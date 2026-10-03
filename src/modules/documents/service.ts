import "server-only";
import { randomUUID } from "node:crypto";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { businessRule, forbidden, notFound } from "@/core/errors";
import { storage } from "@/core/storage";
import type { TenantContext } from "@/core/tenant/context";
import type { z } from "zod";
import { DOC_MAX_BYTES, detectDocument, safeFileName, sha256 } from "./files";
import { parseTags, type EntityType } from "./schemas";
import type { documentMetaSchema, folderSchema, linkSchema, shareSchema, updateDocumentSchema } from "./schemas";

type Ctx = TenantContext;
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);
/** Date d'échéance saisie (YYYY-MM-DD) → date UTC, ou null ; une date invalide est refusée. */
function parseExpiry(v?: string | null): Date | null {
  if (!v || !v.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw businessRule("Date d'échéance invalide.");
  return new Date(`${v}T00:00:00.000Z`);
}

// ═══ Entités rattachables ═════════════════════════════════════

/** Droit de lecture requis sur l'entité pour voir un document qui lui est lié (un document lié à un salarié exige `hr.employee.read`). */
export const ENTITY_READ_PERMISSION: Record<EntityType, string> = {
  customer: "crm.customer.read",
  supplier: "purchases.supplier.read",
  employee: "hr.employee.read",
  project: "project.project.read",
  expense: "finance.expense.read",
  invoice: "finance.invoice.read",
  supplier_bill: "purchases.bill.read",
  purchase_order: "purchases.order.read",
  vehicle: "fleet.vehicle.read",
  driver: "fleet.driver.manage", // permis et pièces d'identité : réservés aux gestionnaires de chauffeurs
  fine: "fleet.fine.read",
  site: "construction.site.read",
  site_report: "construction.site.read",
};

export const ENTITY_LABEL: Record<EntityType, string> = {
  customer: "Client", supplier: "Fournisseur", employee: "Salarié", project: "Projet", expense: "Dépense",
  invoice: "Facture", supplier_bill: "Facture fournisseur", purchase_order: "Commande fournisseur",
  vehicle: "Véhicule", driver: "Chauffeur", fine: "Contravention", site: "Chantier", site_report: "Rapport de chantier",
};

/** Vérifie qu'une entité existe DANS l'entreprise active (ctx.db est isolé) ; retourne un libellé lisible. */
async function entityLabel(db: Db, type: EntityType, id: string): Promise<string> {
  const sel = <T>(row: T | null, label: (r: T) => string) => { if (!row) throw notFound(ENTITY_LABEL[type]); return label(row); };
  switch (type) {
    case "customer": return sel(await db.customer.findFirst({ where: { id, deletedAt: null }, select: { name: true } }), (r) => r.name);
    case "supplier": return sel(await db.supplier.findFirst({ where: { id, deletedAt: null }, select: { name: true } }), (r) => r.name);
    case "employee": return sel(await db.employee.findFirst({ where: { id, deletedAt: null }, select: { firstName: true, lastName: true } }), (r) => `${r.lastName} ${r.firstName}`);
    case "project": return sel(await db.project.findFirst({ where: { id, deletedAt: null }, select: { code: true, name: true } }), (r) => `${r.code} — ${r.name}`);
    case "expense": return sel(await db.expense.findFirst({ where: { id }, select: { number: true } }), (r) => r.number ?? "brouillon");
    case "invoice": return sel(await db.invoice.findFirst({ where: { id }, select: { number: true } }), (r) => r.number ?? "brouillon");
    case "supplier_bill": return sel(await db.supplierBill.findFirst({ where: { id }, select: { number: true } }), (r) => r.number ?? "brouillon");
    case "purchase_order": return sel(await db.purchaseOrder.findFirst({ where: { id }, select: { number: true } }), (r) => r.number ?? "brouillon");
    case "vehicle": return sel(await db.vehicle.findFirst({ where: { id, deletedAt: null }, select: { plate: true } }), (r) => r.plate);
    case "driver": return sel(await db.driver.findFirst({ where: { id, deletedAt: null }, select: { fullName: true } }), (r) => r.fullName);
    case "fine": return sel(await db.trafficFine.findFirst({ where: { id }, select: { number: true } }), (r) => `PV ${r.number}`);
    case "site": return sel(await db.constructionSite.findFirst({ where: { id, deletedAt: null }, select: { code: true, name: true } }), (r) => `${r.code} — ${r.name}`);
    case "site_report": return sel(await db.siteReport.findFirst({ where: { id }, select: { date: true, site: { select: { code: true } } } }), (r) => `Rapport ${r.site.code} du ${r.date.toISOString().slice(0, 10)}`);
  }
}

export const ENTITY_HREF: Record<EntityType, (id: string) => string> = {
  customer: (id) => `/app/crm/clients/${id}`,
  supplier: (id) => `/app/purchases/fournisseurs/${id}`,
  employee: (id) => `/app/hr/salaries/${id}`,
  project: (id) => `/app/projects/projets/${id}`,
  expense: (id) => `/app/finance/depenses/${id}`,
  invoice: (id) => `/app/sales/factures/${id}`,
  supplier_bill: (id) => `/app/purchases/factures/${id}`,
  purchase_order: (id) => `/app/purchases/commandes/${id}`,
  vehicle: (id) => `/app/fleet/vehicules/${id}`,
  driver: () => `/app/fleet/chauffeurs`,
  fine: (id) => `/app/fleet/contraventions/${id}`,
  site: (id) => `/app/construction/chantiers/${id}`,
  site_report: () => `/app/construction`,
};

/** Libellés et liens des entités liées ; une entité que l'utilisateur ne peut pas lire n'est pas détaillée. */
export async function describeLinks(ctx: Ctx, links: { id: string; entityType: string; entityId: string }[]) {
  return Promise.all(links.map(async (l) => {
    const type = l.entityType as EntityType;
    const readable = ENTITY_READ_PERMISSION[type] && ctx.can(ENTITY_READ_PERMISSION[type]);
    const label = readable ? await entityLabel(ctx.db, type, l.entityId).catch(() => "Élément supprimé") : "Élément à accès restreint";
    return { id: l.id, type: ENTITY_LABEL[type] ?? l.entityType, label, href: readable ? ENTITY_HREF[type](l.entityId) : null };
  }));
}

// ═══ Droits d'accès ═══════════════════════════════════════════

interface AccessInfo { ownerId: string; visibility: string; links: { entityType: string }[]; shares: { userId: string; canEdit: boolean }[] }

const isAdmin = (ctx: Ctx) => ctx.access.isAdmin || ctx.membership.isOwner;

/** Lecture : droit « documents » + (propriétaire | admin | partage explicite | document d'entreprise dont les entités liées sont lisibles). */
function canReadDoc(ctx: Ctx, d: AccessInfo): boolean {
  if (!ctx.can("documents.document.read")) return false;
  if (d.ownerId === ctx.user.id || isAdmin(ctx) || d.shares.some((s) => s.userId === ctx.user.id)) return true;
  if (d.visibility === "RESTRICTED") return false;
  return d.links.every((l) => ctx.can(ENTITY_READ_PERMISSION[l.entityType as EntityType] ?? "never.read"));
}

function canEditDoc(ctx: Ctx, d: AccessInfo): boolean {
  if (!ctx.can("documents.document.update")) return false;
  return d.ownerId === ctx.user.id || isAdmin(ctx) || d.shares.some((s) => s.userId === ctx.user.id && s.canEdit);
}

/** Filtre Prisma équivalent à `canReadDoc` pour les listes (le filtrage se fait en base, pas après coup). */
function readableWhere(ctx: Ctx) {
  if (isAdmin(ctx)) return {};
  const denied = (Object.keys(ENTITY_READ_PERMISSION) as EntityType[]).filter((t) => !ctx.can(ENTITY_READ_PERMISSION[t]));
  return {
    OR: [
      { ownerId: ctx.user.id },
      { shares: { some: { userId: ctx.user.id } } },
      { visibility: "COMPANY" as const, ...(denied.length ? { links: { none: { entityType: { in: denied } } } } : {}) },
    ],
  };
}

const docInclude = {
  links: { select: { id: true, entityType: true, entityId: true } },
  shares: { select: { id: true, userId: true, canEdit: true } },
  folder: { select: { id: true, name: true } },
  versions: { orderBy: { version: "desc" as const }, select: { id: true, version: true, fileName: true, mimeType: true, size: true, sha256: true, comment: true, uploadedById: true, createdAt: true } },
};

/** Charge un document lisible par l'utilisateur ; sinon NOT_FOUND (on ne révèle pas l'existence d'un document interdit). */
export async function getDocument(ctx: Ctx, id: string) {
  const doc = await ctx.db.document.findFirst({ where: { id, deletedAt: null }, include: docInclude });
  if (!doc || !canReadDoc(ctx, doc)) throw notFound("Document");
  return { doc, canEdit: canEditDoc(ctx, doc), canManage: d_isManager(ctx, doc), canDelete: ctx.can("documents.document.delete") && (doc.ownerId === ctx.user.id || isAdmin(ctx)) };
}

const d_isManager = (ctx: Ctx, d: AccessInfo) => ctx.can("documents.document.share") && (d.ownerId === ctx.user.id || isAdmin(ctx));

async function loadEditable(ctx: Ctx, id: string, tx: Db = ctx.db) {
  const doc = await tx.document.findFirst({ where: { id, deletedAt: null }, include: { links: { select: { entityType: true } }, shares: { select: { userId: true, canEdit: true } } } });
  if (!doc || !canReadDoc(ctx, doc)) throw notFound("Document");
  if (!canEditDoc(ctx, doc)) throw forbidden("Vous ne pouvez pas modifier ce document.");
  return doc;
}

// ═══ Dossiers ═════════════════════════════════════════════════

export async function listFolders(ctx: Ctx) {
  return ctx.db.docFolder.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, parentId: true, _count: { select: { documents: { where: { deletedAt: null, status: "ACTIVE" } } } } } });
}

export async function createFolder(ctx: Ctx, input: z.output<typeof folderSchema>) {
  const parentId = blank(input.parentId);
  if (parentId && !(await ctx.db.docFolder.findFirst({ where: { id: parentId, deletedAt: null }, select: { id: true } }))) throw notFound("Dossier parent");
  const dup = await ctx.db.docFolder.findFirst({ where: { parentId, name: { equals: input.name, mode: "insensitive" }, deletedAt: null }, select: { id: true } });
  if (dup) throw businessRule("Un dossier de ce nom existe déjà à cet emplacement.");
  const f = await ctx.db.docFolder.create({ data: { companyId: ctx.company.id, parentId, name: input.name, createdById: ctx.user.id } });
  await audit(ctx, { action: "document.folder_create", resource: "DocFolder", resourceId: f.id, summary: `${ctx.user.name} a créé le dossier « ${f.name} ».` });
  return f;
}

export async function renameFolder(ctx: Ctx, id: string, name: string) {
  const f = await ctx.db.docFolder.findFirst({ where: { id, deletedAt: null } });
  if (!f) throw notFound("Dossier");
  const dup = await ctx.db.docFolder.findFirst({ where: { parentId: f.parentId, name: { equals: name, mode: "insensitive" }, deletedAt: null, id: { not: id } }, select: { id: true } });
  if (dup) throw businessRule("Un dossier de ce nom existe déjà à cet emplacement.");
  await ctx.db.docFolder.update({ where: { id }, data: { name } });
  await audit(ctx, { action: "document.folder_rename", resource: "DocFolder", resourceId: id, summary: `${ctx.user.name} a renommé le dossier « ${f.name} » en « ${name} ».` });
}

/** Un dossier ne se supprime que vide (ni sous-dossier, ni document actif ou archivé). */
export async function deleteFolder(ctx: Ctx, id: string) {
  const f = await ctx.db.docFolder.findFirst({ where: { id, deletedAt: null } });
  if (!f) throw notFound("Dossier");
  const [kids, docs] = await Promise.all([
    ctx.db.docFolder.count({ where: { parentId: id, deletedAt: null } }),
    ctx.db.document.count({ where: { folderId: id, deletedAt: null } }),
  ]);
  if (kids > 0 || docs > 0) throw businessRule("Ce dossier n'est pas vide : déplacez ou supprimez son contenu d'abord.");
  await ctx.db.docFolder.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(ctx, { action: "document.folder_delete", resource: "DocFolder", resourceId: id, summary: `${ctx.user.name} a supprimé le dossier « ${f.name} ».` });
}

async function assertFolder(db: Db, id?: string | null) {
  if (id && !(await db.docFolder.findFirst({ where: { id, deletedAt: null }, select: { id: true } }))) throw notFound("Dossier");
}

// ═══ Documents ════════════════════════════════════════════════

export async function listDocuments(ctx: Ctx, p: { q?: string; folderId?: string | null; status?: "ACTIVE" | "ARCHIVED"; entity?: { type: EntityType; id: string }; tag?: string; expiring?: boolean; skip: number; take: number }) {
  ctx.assertCan("documents.document.read");
  const and: object[] = [readableWhere(ctx)];
  if (p.q) and.push({ OR: [{ name: { contains: p.q, mode: "insensitive" } }, { description: { contains: p.q, mode: "insensitive" } }, { tags: { has: p.q.toLowerCase() } }] });
  if (p.tag) and.push({ tags: { has: p.tag.toLowerCase() } });
  // « À renouveler » : déjà expirés ou expirant sous 30 jours
  if (p.expiring) and.push({ expiresAt: { not: null, lte: new Date(Date.now() + 30 * 86_400_000) } });
  if (p.entity) and.push({ links: { some: { entityType: p.entity.type, entityId: p.entity.id } } });
  const where = { deletedAt: null, status: p.status ?? "ACTIVE", ...(p.folderId !== undefined && !p.q && !p.tag && !p.expiring ? { folderId: p.folderId } : {}), AND: and } as never;
  const [total, rows] = await Promise.all([
    ctx.db.document.count({ where }),
    ctx.db.document.findMany({ where, orderBy: p.expiring ? [{ expiresAt: "asc" }] : [{ updatedAt: "desc" }], skip: p.skip, take: p.take, include: { folder: { select: { id: true, name: true } }, links: { select: { entityType: true } }, versions: { orderBy: { version: "desc" }, take: 1, select: { mimeType: true, size: true, fileName: true } } } }),
  ]);
  return { total, rows };
}

/** Documents liés à une entité (panneau « Documents » des fiches). Le droit de lecture de l'entité est revérifié ici. */
export async function listEntityDocuments(ctx: Ctx, type: EntityType, entityId: string) {
  if (!ctx.can("documents.document.read") || !ctx.can(ENTITY_READ_PERMISSION[type])) return [];
  const { rows } = await listDocuments(ctx, { entity: { type, id: entityId }, skip: 0, take: 100 });
  return rows;
}

/** Valide le fichier (taille, type réel, nom) et retourne ce qu'il faut stocker. */
export function inspectUpload(file: { name: string; size: number }, data: Buffer) {
  if (data.length === 0) throw businessRule("Le fichier est vide.");
  if (data.length > DOC_MAX_BYTES) throw businessRule(`Le fichier dépasse ${DOC_MAX_BYTES / 1024 / 1024} Mo.`);
  const type = detectDocument(data, file.name);
  if (!type) throw businessRule("Format non accepté. Formats autorisés : PDF, images (PNG, JPEG, WebP, GIF), Word, Excel, PowerPoint, TXT, CSV.");
  return { ...type, fileName: safeFileName(file.name, type.ext), size: data.length, sha256: sha256(data) };
}

async function assertLinkable(ctx: Ctx, type: EntityType, id: string) {
  if (!ctx.can(ENTITY_READ_PERMISSION[type])) throw forbidden("Vous n'avez pas accès à cet élément.");
  await entityLabel(ctx.db, type, id);
}

export async function createDocument(ctx: Ctx, meta: z.output<typeof documentMetaSchema>, file: { name: string; size: number }, data: Buffer, link?: { entityType: EntityType; entityId: string }) {
  const up = inspectUpload(file, data);
  const folderId = blank(meta.folderId);
  await assertFolder(ctx.db, folderId);
  if (link) await assertLinkable(ctx, link.entityType, link.entityId);

  const versionId = randomUUID();
  const storageKey = `${ctx.company.id}/${versionId}.${up.ext}`;
  await storage.put(storageKey, data);
  try {
    return await ctx.tx(async (tx) => {
      const doc = await tx.document.create({
        data: { companyId: ctx.company.id, folderId, name: meta.name, description: blank(meta.description), visibility: meta.visibility, tags: parseTags(meta.tags), expiresAt: parseExpiry(meta.expiresAt), ownerId: ctx.user.id, currentVersion: 1 },
      });
      await tx.documentVersion.create({ data: { id: versionId, companyId: ctx.company.id, documentId: doc.id, version: 1, fileName: up.fileName, mimeType: up.mime, size: up.size, sha256: up.sha256, storageKey, uploadedById: ctx.user.id } });
      if (link) await tx.documentLink.create({ data: { companyId: ctx.company.id, documentId: doc.id, entityType: link.entityType, entityId: link.entityId } });
      await audit(ctx, { action: "document.create", resource: "Document", resourceId: doc.id, summary: `${ctx.user.name} a ajouté le document « ${doc.name} » (${up.fileName}).` }, tx);
      return doc;
    });
  } catch (e) {
    await storage.delete(storageKey).catch(() => undefined); // pas de fichier orphelin si la base refuse
    throw e;
  }
}

/** Nouvelle version : la précédente reste consultable. Le numéro est attribué sous verrou de ligne (pas de doublon en cas d'envois simultanés). */
export async function addVersion(ctx: Ctx, id: string, file: { name: string; size: number }, data: Buffer, comment?: string | null) {
  await loadEditable(ctx, id);
  const up = inspectUpload(file, data);
  const versionId = randomUUID();
  const storageKey = `${ctx.company.id}/${versionId}.${up.ext}`;
  await storage.put(storageKey, data);
  try {
    return await ctx.tx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Document" WHERE id = ${id}::uuid FOR UPDATE`;
      const doc = await loadEditable(ctx, id, tx);
      if (doc.status === "ARCHIVED") throw businessRule("Ce document est archivé : restaurez-le avant d'ajouter une version.");
      const last = await tx.documentVersion.findFirst({ where: { documentId: id }, orderBy: { version: "desc" }, select: { version: true } });
      const version = (last?.version ?? 0) + 1;
      await tx.documentVersion.create({ data: { id: versionId, companyId: ctx.company.id, documentId: id, version, fileName: up.fileName, mimeType: up.mime, size: up.size, sha256: up.sha256, storageKey, comment: blank(comment), uploadedById: ctx.user.id } });
      await tx.document.update({ where: { id }, data: { currentVersion: version } });
      await audit(ctx, { action: "document.version_add", resource: "Document", resourceId: id, summary: `${ctx.user.name} a ajouté la version ${version} du document « ${doc.name} ».` }, tx);
      return { version };
    });
  } catch (e) {
    await storage.delete(storageKey).catch(() => undefined);
    throw e;
  }
}

export async function updateDocument(ctx: Ctx, input: z.output<typeof updateDocumentSchema>) {
  const doc = await loadEditable(ctx, input.id);
  const folderId = blank(input.folderId);
  await assertFolder(ctx.db, folderId);
  // Rendre un document restreint (ou changer sa visibilité) revient à en gérer l'accès : propriétaire ou admin seulement
  if (input.visibility !== doc.visibility && !(doc.ownerId === ctx.user.id || isAdmin(ctx))) throw forbidden("Seul le propriétaire peut changer la visibilité.");
  await ctx.db.document.update({ where: { id: input.id }, data: { name: input.name, description: blank(input.description), folderId, visibility: input.visibility, tags: parseTags(input.tags), expiresAt: parseExpiry(input.expiresAt) } });
  await audit(ctx, { action: "document.update", resource: "Document", resourceId: input.id, summary: `${ctx.user.name} a modifié le document « ${input.name} ».` });
}

export async function setArchived(ctx: Ctx, id: string, archived: boolean) {
  const doc = await loadEditable(ctx, id);
  await ctx.db.document.update({ where: { id }, data: { status: archived ? "ARCHIVED" : "ACTIVE" } });
  await audit(ctx, { action: archived ? "document.archive" : "document.restore", resource: "Document", resourceId: id, summary: `${ctx.user.name} a ${archived ? "archivé" : "restauré"} le document « ${doc.name} ».` });
}

/** Suppression (logique) : le document disparaît des listes, ses fichiers sont purgés du stockage. Réservé au propriétaire ou à un admin. */
export async function deleteDocument(ctx: Ctx, id: string) {
  const doc = await ctx.db.document.findFirst({ where: { id, deletedAt: null }, include: { links: { select: { entityType: true } }, shares: { select: { userId: true, canEdit: true } }, versions: { select: { storageKey: true } } } });
  if (!doc || !canReadDoc(ctx, doc)) throw notFound("Document");
  if (!(doc.ownerId === ctx.user.id || isAdmin(ctx))) throw forbidden("Seul le propriétaire du document peut le supprimer.");
  await ctx.tx(async (tx) => {
    await tx.document.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(ctx, { action: "document.delete", resource: "Document", resourceId: id, summary: `${ctx.user.name} a supprimé le document « ${doc.name} ».` }, tx);
  });
  await Promise.all(doc.versions.map((v) => storage.delete(v.storageKey).catch(() => undefined)));
}

// ═══ Liens et partage ═════════════════════════════════════════

export async function linkDocument(ctx: Ctx, input: z.output<typeof linkSchema>) {
  await loadEditable(ctx, input.id);
  await assertLinkable(ctx, input.entityType, input.entityId);
  const exists = await ctx.db.documentLink.findFirst({ where: { documentId: input.id, entityType: input.entityType, entityId: input.entityId }, select: { id: true } });
  if (exists) throw businessRule("Ce document est déjà lié à cet élément.");
  await ctx.db.documentLink.create({ data: { companyId: ctx.company.id, documentId: input.id, entityType: input.entityType, entityId: input.entityId } });
  await audit(ctx, { action: "document.link", resource: "Document", resourceId: input.id, summary: `${ctx.user.name} a lié un document à : ${ENTITY_LABEL[input.entityType]}.` });
}

export async function unlinkDocument(ctx: Ctx, linkId: string) {
  const link = await ctx.db.documentLink.findFirst({ where: { id: linkId } });
  if (!link) throw notFound("Lien");
  await loadEditable(ctx, link.documentId);
  await ctx.db.documentLink.delete({ where: { id: linkId } });
  await audit(ctx, { action: "document.unlink", resource: "Document", resourceId: link.documentId, summary: `${ctx.user.name} a retiré un lien de document (${ENTITY_LABEL[link.entityType as EntityType] ?? link.entityType}).` });
}

/** Membres actifs de l'entreprise (cibles possibles d'un partage). */
export async function shareTargets(ctx: Ctx) {
  const rows = await ctx.db.companyMembership.findMany({ where: { status: "ACTIVE" }, select: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => r.user);
}

export async function shareDocument(ctx: Ctx, input: z.output<typeof shareSchema>) {
  const { doc } = await getDocument(ctx, input.id);
  if (!d_isManager(ctx, doc)) throw forbidden("Seul le propriétaire peut partager ce document.");
  if (input.userId === doc.ownerId) throw businessRule("Le propriétaire a déjà accès au document.");
  // Le destinataire doit être membre ACTIF de l'entreprise (jamais un identifiant d'utilisateur arbitraire)
  const member = await ctx.db.companyMembership.findFirst({ where: { userId: input.userId, status: "ACTIVE" }, select: { user: { select: { name: true } } } });
  if (!member) throw notFound("Utilisateur");
  await ctx.db.documentShare.upsert({
    where: { documentId_userId: { documentId: input.id, userId: input.userId } },
    create: { companyId: ctx.company.id, documentId: input.id, userId: input.userId, canEdit: input.canEdit },
    update: { canEdit: input.canEdit },
  });
  await audit(ctx, { action: "document.share", resource: "Document", resourceId: input.id, summary: `${ctx.user.name} a partagé « ${doc.name} » avec ${member.user.name}${input.canEdit ? " (modification autorisée)" : ""}.` });
}

export async function unshareDocument(ctx: Ctx, id: string, userId: string) {
  const { doc } = await getDocument(ctx, id);
  if (!d_isManager(ctx, doc)) throw forbidden("Seul le propriétaire peut gérer le partage.");
  await ctx.db.documentShare.deleteMany({ where: { documentId: id, userId } });
  await audit(ctx, { action: "document.unshare", resource: "Document", resourceId: id, summary: `${ctx.user.name} a retiré un partage sur « ${doc.name} ».` });
}

// ═══ Téléchargement ═══════════════════════════════════════════

/** Lit le contenu d'une version (courante par défaut) après revérification complète des droits. */
export async function readVersion(ctx: Ctx, id: string, version?: number) {
  const { doc } = await getDocument(ctx, id);
  const v = await ctx.db.documentVersion.findFirst({ where: { documentId: id, version: version ?? doc.currentVersion } });
  if (!v) throw notFound("Version");
  const data = await storage.get(v.storageKey);
  if (!data) throw notFound("Fichier");
  // Intégrité : le contenu relu doit correspondre à l'empreinte enregistrée
  if (sha256(data) !== v.sha256) throw businessRule("Le fichier stocké est altéré (empreinte différente).");
  await audit(ctx, { action: "document.download", resource: "Document", resourceId: id, summary: `${ctx.user.name} a téléchargé « ${doc.name} » (version ${v.version}).` });
  return { data, version: v };
}
