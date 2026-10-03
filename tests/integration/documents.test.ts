import { describe, expect, it, vi } from "vitest";

// Les fichiers de test vont dans un dossier temporaire, jamais dans ./uploads
vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs"), os = process.getBuiltinModule("node:os"), path = process.getBuiltinModule("node:path");
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "afg-docs-"));
});

import { platformDb } from "@/core/db/client";
import { storage } from "@/core/storage";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { customerSchema } from "@/modules/crm/schemas";
import * as crm from "@/modules/crm/service";
import { documentMetaSchema } from "@/modules/documents/schemas";
import * as docs from "@/modules/documents/service";
import * as emp from "@/modules/hr/employees";
import { employeeSchema } from "@/modules/hr/schemas";
import { addMember, ctxFor, makeCompany, makeUser } from "../helpers";

const PDF = (extra = "") => Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\n${extra}\n%%EOF`);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("[Content_Types].xml word/document.xml"), Buffer.alloc(64)]);
const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 1)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const meta = (over: Record<string, unknown> = {}) => documentMetaSchema.parse({ name: "Contrat cadre", ...over });
const file = (name: string, data: Buffer) => ({ name, size: data.length });
const upload = (ctx: Awaited<ReturnType<typeof ctxFor>>, over: Record<string, unknown> = {}, data = PDF(), name = "contrat.pdf", link?: Parameters<typeof docs.createDocument>[4]) =>
  docs.createDocument(ctx, meta(over), file(name, data), data, link);

async function setup() {
  const co = await makeCompany("GED", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  return { ...co, ctx };
}
const memberCtx = async (companyId: string, role: string) => {
  const m = await addMember(companyId, role);
  return { ...m, ctx: await ctxFor(m.user.id, companyId) };
};

describe("GED — validation des fichiers", () => {
  it("accepte PDF, image, Word, texte ; refuse exécutable, SVG, faux PDF, vide, trop gros", async () => {
    const s = await setup();
    await expect(upload(s.ctx)).resolves.toBeTruthy();
    await expect(upload(s.ctx, {}, PNG, "logo.png")).resolves.toBeTruthy();
    await expect(upload(s.ctx, {}, DOCX, "lettre.docx")).resolves.toBeTruthy();
    await expect(upload(s.ctx, {}, Buffer.from("a;b\n1;2\n"), "export.csv")).resolves.toBeTruthy();

    // le type se juge sur les octets, pas sur le nom
    await expect(upload(s.ctx, {}, EXE, "facture.pdf")).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Format") });
    await expect(upload(s.ctx, {}, SVG, "image.svg")).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(upload(s.ctx, {}, SVG, "image.png")).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(upload(s.ctx, {}, Buffer.from("MZ binaire\0\0"), "notes.txt")).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(upload(s.ctx, {}, Buffer.from("PK\x03\x04 zip quelconque"), "x.docx")).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(upload(s.ctx, {}, Buffer.alloc(0), "vide.pdf")).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(upload(s.ctx, {}, Buffer.concat([PDF(), Buffer.alloc(8 * 1024 * 1024)]), "gros.pdf")).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Mo") });
    // rien d'orphelin en base pour les refus
    expect(await s.ctx.db.document.count()).toBe(4);
  });

  it("assainit le nom de fichier (chemin, caractères spéciaux) et aligne l'extension sur le type réel", async () => {
    const s = await setup();
    const d = await upload(s.ctx, {}, PDF(), "..\\..\\etc/passwd<script>.exe");
    const v = await s.ctx.db.documentVersion.findFirstOrThrow({ where: { documentId: d.id } });
    expect(v.fileName).toBe("passwdscript.pdf");
    expect(v.storageKey).toMatch(new RegExp(`^${s.company.id}/[0-9a-f-]{36}\\.pdf$`));
    expect(v.mimeType).toBe("application/pdf");
  });
});

describe("GED — versions", () => {
  it("conserve les anciennes versions, vérifie l'empreinte SHA-256 et refuse un fichier altéré", async () => {
    const s = await setup();
    const d = await upload(s.ctx, {}, PDF("v1"));
    await docs.addVersion(s.ctx, d.id, file("v2.pdf", PDF("v2")), PDF("v2"), "Corrections juridiques");
    const { doc } = await docs.getDocument(s.ctx, d.id);
    expect(doc.currentVersion).toBe(2);
    expect(doc.versions.map((v) => v.version)).toEqual([2, 1]);
    expect((await docs.readVersion(s.ctx, d.id)).data.toString()).toContain("v2");
    expect((await docs.readVersion(s.ctx, d.id, 1)).data.toString()).toContain("v1");
    await expect(docs.readVersion(s.ctx, d.id, 9)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const v1 = doc.versions.find((v) => v.version === 1)!;
    const row = await s.ctx.db.documentVersion.findFirstOrThrow({ where: { id: v1.id } });
    await storage.put(row.storageKey, PDF("trafiqué"));
    await expect(docs.readVersion(s.ctx, d.id, 1)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("altéré") });
  });

  it("envois simultanés : numéros de version uniques, aucun doublon", async () => {
    const s = await setup();
    const d = await upload(s.ctx);
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => docs.addVersion(s.ctx, d.id, file(`c${i}.pdf`, PDF(`c${i}`)), PDF(`c${i}`))));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const versions = (await s.ctx.db.documentVersion.findMany({ where: { documentId: d.id }, select: { version: true } })).map((v) => v.version).sort((a, b) => a - b);
    expect(versions).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await docs.getDocument(s.ctx, d.id)).doc.currentVersion).toBe(6);
  });

  it("document archivé : pas de nouvelle version tant qu'il n'est pas restauré", async () => {
    const s = await setup();
    const d = await upload(s.ctx);
    await docs.setArchived(s.ctx, d.id, true);
    await expect(docs.addVersion(s.ctx, d.id, file("x.pdf", PDF("x")), PDF("x"))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect((await docs.listDocuments(s.ctx, { skip: 0, take: 20 })).total).toBe(0);
    expect((await docs.listDocuments(s.ctx, { status: "ARCHIVED", skip: 0, take: 20 })).total).toBe(1);
    await docs.setArchived(s.ctx, d.id, false);
    await expect(docs.addVersion(s.ctx, d.id, file("x.pdf", PDF("x")), PDF("x"))).resolves.toMatchObject({ version: 2 });
  });
});

describe("GED — isolation entre entreprises", () => {
  it("l'entreprise B ne voit, ne lit, ne modifie, ne partage ni ne supprime les documents de A", async () => {
    const a = await setup();
    const b = await setup();
    const d = await upload(a.ctx);
    const folder = await docs.createFolder(a.ctx, { name: "Contrats" });

    await expect(docs.getDocument(b.ctx, d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(docs.readVersion(b.ctx, d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(docs.addVersion(b.ctx, d.id, file("x.pdf", PDF("x")), PDF("x"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(docs.updateDocument(b.ctx, { id: d.id, name: "Piraté", visibility: "COMPANY" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(docs.setArchived(b.ctx, d.id, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(docs.deleteDocument(b.ctx, d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(docs.shareDocument(b.ctx, { id: d.id, userId: b.owner.id, canEdit: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await docs.listDocuments(b.ctx, { skip: 0, take: 20 })).total).toBe(0);
    expect((await docs.listFolders(b.ctx)).length).toBe(0);
    await expect(docs.renameFolder(b.ctx, folder.id, "X")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(docs.deleteFolder(b.ctx, folder.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    // B ne peut pas ranger un document dans un dossier de A, ni le lier à une entité de A
    await expect(upload(b.ctx, { folderId: folder.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const cust = await crm.createCustomer(a.ctx, customerSchema.parse({ type: "COMPANY", name: "Client A", paymentTermsDays: 30 }));
    await expect(upload(b.ctx, {}, PDF(), "x.pdf", { entityType: "customer", entityId: cust.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(docs.createFolder(b.ctx, { name: "Sous-dossier", parentId: folder.id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // le document de A est intact
    expect((await docs.getDocument(a.ctx, d.id)).doc.name).toBe("Contrat cadre");
  });

  it("un membre de A ne peut pas recevoir un partage destiné à un utilisateur d'une autre entreprise", async () => {
    const a = await setup();
    const outsider = await makeUser();
    const d = await upload(a.ctx);
    await expect(docs.shareDocument(a.ctx, { id: d.id, userId: outsider.id, canEdit: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const b = await setup();
    await expect(docs.shareDocument(a.ctx, { id: d.id, userId: b.owner.id, canEdit: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("GED — contrôle d'accès", () => {
  it("document restreint : visible du propriétaire, des admins et des destinataires seulement ; partage en lecture ≠ modification", async () => {
    const s = await setup();
    const hr = await memberCtx(s.company.id, "hr");
    const pm = await memberCtx(s.company.id, "project_manager");
    const d = await upload(hr.ctx, { visibility: "RESTRICTED", name: "Procédure disciplinaire" });

    await expect(docs.getDocument(pm.ctx, d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await docs.listDocuments(pm.ctx, { skip: 0, take: 20 })).total).toBe(0);
    await expect(docs.readVersion(pm.ctx, d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // le propriétaire du compte (admin) et l'auteur voient le document
    await expect(docs.getDocument(s.ctx, d.id)).resolves.toBeTruthy();
    expect((await docs.listDocuments(hr.ctx, { skip: 0, take: 20 })).total).toBe(1);

    // seul le propriétaire (ou un admin) partage
    await expect(docs.shareDocument(pm.ctx, { id: d.id, userId: pm.user.id, canEdit: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await docs.shareDocument(hr.ctx, { id: d.id, userId: pm.user.id, canEdit: false });
    expect((await docs.getDocument(pm.ctx, d.id)).canEdit).toBe(false);
    expect((await docs.listDocuments(pm.ctx, { skip: 0, take: 20 })).total).toBe(1);
    await expect(docs.addVersion(pm.ctx, d.id, file("x.pdf", PDF("x")), PDF("x"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(docs.deleteDocument(pm.ctx, d.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(docs.shareDocument(pm.ctx, { id: d.id, userId: s.owner.id, canEdit: false })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await docs.shareDocument(hr.ctx, { id: d.id, userId: pm.user.id, canEdit: true });
    await expect(docs.addVersion(pm.ctx, d.id, file("x.pdf", PDF("x")), PDF("x"))).resolves.toMatchObject({ version: 2 });
    // un destinataire éditeur ne peut pas rendre le document public
    await expect(docs.updateDocument(pm.ctx, { id: d.id, name: "Procédure", visibility: "COMPANY" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await docs.unshareDocument(hr.ctx, d.id, pm.user.id);
    await expect(docs.getDocument(pm.ctx, d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("document lié à un salarié : exige hr.employee.read ; sans ce droit il est absent des listes et illisible", async () => {
    const s = await setup();
    const hr = await memberCtx(s.company.id, "hr");
    const pm = await memberCtx(s.company.id, "project_manager"); // a hr.employee.read
    const fleet = await memberCtx(s.company.id, "fleet_manager"); // a documents.* mais pas hr.employee.read
    const e = await emp.createEmployee(hr.ctx, employeeSchema.parse({ firstName: "Awa", lastName: "Koné", hireDate: "2020-01-06", baseSalary: 352000 }));
    const d = await upload(hr.ctx, { name: "Contrat de travail Awa" }, PDF(), "ct.pdf", { entityType: "employee", entityId: e.id });
    const free = await upload(hr.ctx, { name: "Note interne" });

    await expect(docs.getDocument(pm.ctx, d.id)).resolves.toBeTruthy();
    await expect(docs.getDocument(fleet.ctx, d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(docs.readVersion(fleet.ctx, d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const seen = (await docs.listDocuments(fleet.ctx, { skip: 0, take: 20 })).rows.map((r) => r.id);
    expect(seen).toContain(free.id);
    expect(seen).not.toContain(d.id);
    // le panneau d'une fiche salarié est vide pour qui ne peut pas lire les salariés
    expect(await docs.listEntityDocuments(fleet.ctx, "employee", e.id)).toEqual([]);
    expect((await docs.listEntityDocuments(pm.ctx, "employee", e.id)).map((r) => r.id)).toEqual([d.id]);
    // et on ne peut pas lier un document à une fiche qu'on n'a pas le droit de lire
    await expect(docs.linkDocument(fleet.ctx, { id: free.id, entityType: "employee", entityId: e.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rôles sans droit « documents » ou en lecture seule", async () => {
    const s = await setup();
    const acc = await memberCtx(s.company.id, "accountant");
    const viewer = await memberCtx(s.company.id, "viewer");
    const d = await upload(s.ctx);
    await expect(docs.getDocument(acc.ctx, d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(docs.listDocuments(acc.ctx, { skip: 0, take: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await docs.getDocument(viewer.ctx, d.id)).canEdit).toBe(false);
    await expect(docs.addVersion(viewer.ctx, d.id, file("x.pdf", PDF("x")), PDF("x"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(docs.deleteDocument(viewer.ctx, d.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(docs.updateDocument(viewer.ctx, { id: d.id, name: "X", visibility: "COMPANY" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("GED — dossiers, liens, suppression", () => {
  it("arborescence : doublon refusé, dossier non vide non supprimable, déplacement de document", async () => {
    const s = await setup();
    const root = await docs.createFolder(s.ctx, { name: "Juridique" });
    const sub = await docs.createFolder(s.ctx, { name: "Baux", parentId: root.id });
    await expect(docs.createFolder(s.ctx, { name: "juridique" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(docs.createFolder(s.ctx, { name: "Baux", parentId: root.id })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const d = await upload(s.ctx, { folderId: sub.id });
    await expect(docs.deleteFolder(s.ctx, root.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(docs.deleteFolder(s.ctx, sub.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect((await docs.listDocuments(s.ctx, { folderId: sub.id, skip: 0, take: 20 })).total).toBe(1);
    expect((await docs.listDocuments(s.ctx, { folderId: null, skip: 0, take: 20 })).total).toBe(0);
    await docs.updateDocument(s.ctx, { id: d.id, name: "Bail", folderId: "", visibility: "COMPANY" });
    await docs.deleteFolder(s.ctx, sub.id);
    await docs.deleteFolder(s.ctx, root.id);
    expect(await docs.listFolders(s.ctx)).toHaveLength(0);
  });

  it("liens : entité de l'entreprise requise, doublon refusé, panneau de la fiche, recherche par étiquette", async () => {
    const s = await setup();
    const cust = await crm.createCustomer(s.ctx, customerSchema.parse({ type: "COMPANY", name: "Client Lié", paymentTermsDays: 30 }));
    const d = await upload(s.ctx, { tags: "Contrat, SIGNÉ, contrat" });
    expect((await docs.getDocument(s.ctx, d.id)).doc.tags).toEqual(["contrat", "signé"]);
    await docs.linkDocument(s.ctx, { id: d.id, entityType: "customer", entityId: cust.id });
    await expect(docs.linkDocument(s.ctx, { id: d.id, entityType: "customer", entityId: cust.id })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(docs.linkDocument(s.ctx, { id: d.id, entityType: "customer", entityId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await docs.listEntityDocuments(s.ctx, "customer", cust.id)).map((r) => r.id)).toEqual([d.id]);
    expect((await docs.listDocuments(s.ctx, { q: "signé", skip: 0, take: 20 })).total).toBe(1);
    const link = (await docs.getDocument(s.ctx, d.id)).doc.links[0]!;
    await docs.unlinkDocument(s.ctx, link.id);
    expect(await docs.listEntityDocuments(s.ctx, "customer", cust.id)).toEqual([]);
  });

  it("suppression : propriétaire ou admin seulement ; document et fichiers disparaissent", async () => {
    const s = await setup();
    const hr = await memberCtx(s.company.id, "hr");
    const pm = await memberCtx(s.company.id, "project_manager");
    const d = await upload(hr.ctx);
    const key = (await s.ctx.db.documentVersion.findFirstOrThrow({ where: { documentId: d.id } })).storageKey;
    await expect(docs.deleteDocument(pm.ctx, d.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await storage.get(key)).not.toBeNull();
    await docs.deleteDocument(hr.ctx, d.id);
    await expect(docs.getDocument(s.ctx, d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await storage.get(key)).toBeNull();
    expect((await docs.listDocuments(s.ctx, { skip: 0, take: 20 })).total).toBe(0);
    // la suppression reste tracée dans le journal d'audit
    expect(await s.ctx.db.auditLog.count({ where: { action: "document.delete", resourceId: d.id } })).toBe(1);
  });
});
