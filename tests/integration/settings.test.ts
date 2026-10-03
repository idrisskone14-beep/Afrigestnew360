import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { createInvitation, acceptInvitation, previewInvitation } from "@/core/tenant/invitations";
import { changeMemberRole, removeMember, setMemberStatus } from "@/modules/settings/members";
import { createRole, deleteRole, getRolePermissionKeys, updateRole } from "@/modules/settings/roles";
import { addMember, ctxFor, makeCompany, uid } from "../helpers";

describe("rôles : anti-escalade de privilèges", () => {
  it("un administrateur crée un rôle, copie et modifie ses permissions", async () => {
    const { company, owner } = await makeCompany("Roles");
    const admin = await ctxFor(owner.id, company.id);
    const role = await createRole(admin, { name: "Logisticien", copyFromRoleId: (await platformDb.role.findFirstOrThrow({ where: { companyId: company.id, templateKey: "stock_manager" } })).id });
    const keys = await getRolePermissionKeys(admin, role.id);
    expect(keys).toContain("inventory.stock.adjust");

    await updateRole(admin, { roleId: role.id, name: "Logisticien", permissionKeys: ["inventory.stock.read"] });
    expect(await getRolePermissionKeys(admin, role.id)).toEqual(["inventory.stock.read"]);
  });

  it("un non-admin ayant roles.role.manage ne peut pas accorder ce qu'il ne détient pas", async () => {
    const { company, owner } = await makeCompany("Escalade");
    const admin = await ctxFor(owner.id, company.id);
    // rôle « Gestionnaire de rôles » : roles.role.manage + lecture stock uniquement
    const mgrRole = await createRole(admin, { name: "Gestionnaire de rôles" });
    await updateRole(admin, { roleId: mgrRole.id, name: "Gestionnaire de rôles", permissionKeys: ["roles.role.manage", "roles.role.read", "inventory.stock.read"] });
    const user = await platformDb.user.create({ data: { email: `mgr-${uid()}@t.local`, name: "Mgr", passwordHash: "x" } });
    await platformDb.companyMembership.create({ data: { userId: user.id, companyId: company.id, roleId: mgrRole.id } });
    const mgr = await ctxFor(user.id, company.id);

    const target = await createRole(mgr, { name: "Cible" });
    // peut accorder ce qu'il détient
    await updateRole(mgr, { roleId: target.id, name: "Cible", permissionKeys: ["inventory.stock.read"] });
    // ne peut pas accorder une permission qu'il n'a pas (paie)
    await expect(updateRole(mgr, { roleId: target.id, name: "Cible", permissionKeys: ["inventory.stock.read", "hr.payroll.manage"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // ne peut pas copier un rôle administrateur
    const adminRole = await platformDb.role.findFirstOrThrow({ where: { companyId: company.id, isAdmin: true } });
    await expect(createRole(mgr, { name: "Copie admin", copyFromRoleId: adminRole.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // ne peut pas modifier le rôle administrateur
    await expect(updateRole(mgr, { roleId: adminRole.id, name: "Administrateur", permissionKeys: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("le rôle Administrateur reste intact et indélébile ; un rôle utilisé n'est pas supprimable", async () => {
    const { company, owner } = await makeCompany("Del");
    const admin = await ctxFor(owner.id, company.id);
    const adminRole = await platformDb.role.findFirstOrThrow({ where: { companyId: company.id, isAdmin: true } });
    await expect(deleteRole(admin, adminRole.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(updateRole(admin, { roleId: adminRole.id, name: "X", permissionKeys: ["finance.invoice.read"] })).rejects.toMatchObject({ code: "BUSINESS_RULE" });

    const { role } = await addMember(company.id, "employee");
    await expect(deleteRole(admin, role.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const free = await createRole(admin, { name: "Temporaire" });
    await deleteRole(admin, free.id);
    expect(await platformDb.role.findUnique({ where: { id: free.id } })).toBeNull();
  });

  it("ne peut pas manipuler le rôle d'une AUTRE entreprise", async () => {
    const A = await makeCompany("RA");
    const B = await makeCompany("RB");
    const adminA = await ctxFor(A.owner.id, A.company.id);
    const roleB = await platformDb.role.findFirstOrThrow({ where: { companyId: B.company.id, templateKey: "employee" } });
    await expect(updateRole(adminA, { roleId: roleB.id, name: "Piraté", permissionKeys: [] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteRole(adminA, roleB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getRolePermissionKeys(adminA, roleB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await platformDb.role.findUniqueOrThrow({ where: { id: roleB.id } })).name).toBe("Employé");
  });
});

describe("membres", () => {
  it("garde toujours au moins un administrateur actif", async () => {
    const { company, owner } = await makeCompany("Last");
    const admin = await ctxFor(owner.id, company.id);
    const second = await addMember(company.id, "admin");
    const ownerMembership = await platformDb.companyMembership.findUniqueOrThrow({ where: { userId_companyId: { userId: owner.id, companyId: company.id } } });
    // le propriétaire est protégé
    await expect(removeMember(admin, ownerMembership.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    // on peut rétrograder le 2ᵉ admin tant qu'il reste le propriétaire
    const employee = await platformDb.role.findFirstOrThrow({ where: { companyId: company.id, templateKey: "employee" } });
    await changeMemberRole(admin, { membershipId: second.membership.id, roleId: employee.id });
    // un seul admin → rétrograder le propriétaire (via un autre admin) est impossible
    const third = await addMember(company.id, "admin");
    const thirdCtx = await ctxFor(third.user.id, company.id);
    await changeMemberRole(thirdCtx, { membershipId: ownerMembership.id, roleId: employee.id });
    await expect(changeMemberRole(admin, { membershipId: third.membership.id, roleId: employee.id })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("un non-admin ne peut ni attribuer le rôle admin ni agir sur un admin", async () => {
    const { company, owner } = await makeCompany("Adm");
    const hr = await addMember(company.id, "hr");
    await platformDb.rolePermission.createMany({
      data: (await platformDb.permission.findMany({ where: { key: { in: ["users.member.read", "users.member.update", "users.member.invite", "users.member.remove"] } } })).map((p) => ({ roleId: hr.role.id, companyId: company.id, permissionId: p.id })),
      skipDuplicates: true,
    });
    const hrCtx = await ctxFor(hr.user.id, company.id);
    const adminRole = await platformDb.role.findFirstOrThrow({ where: { companyId: company.id, isAdmin: true } });
    const victim = await addMember(company.id, "employee");
    await expect(changeMemberRole(hrCtx, { membershipId: victim.membership.id, roleId: adminRole.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ownerMembership = await platformDb.companyMembership.findUniqueOrThrow({ where: { userId_companyId: { userId: owner.id, companyId: company.id } } });
    await expect(setMemberStatus(hrCtx, { membershipId: ownerMembership.id, status: "SUSPENDED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createInvitation(hrCtx, { email: `x-${uid()}@t.local`, roleId: adminRole.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("n'agit jamais sur le membre d'une autre entreprise", async () => {
    const A = await makeCompany("MA");
    const B = await makeCompany("MB");
    const adminA = await ctxFor(A.owner.id, A.company.id);
    const victimB = await addMember(B.company.id, "employee");
    await expect(removeMember(adminA, victimB.membership.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setMemberStatus(adminA, { membershipId: victimB.membership.id, status: "SUSPENDED" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await platformDb.companyMembership.findUniqueOrThrow({ where: { id: victimB.membership.id } })).status).toBe("ACTIVE");
  });
});

describe("invitations", () => {
  it("invite, prévisualise, accepte (nouvel utilisateur) et crée le membership", async () => {
    const { company, owner } = await makeCompany("Inv", "business");
    const admin = await ctxFor(owner.id, company.id);
    const role = await platformDb.role.findFirstOrThrow({ where: { companyId: company.id, templateKey: "sales_rep" } });
    const email = `new-${uid()}@t.local`;

    let sentLink = "";
    const logSpy = (m: unknown) => { sentLink += String(m); };
    const orig = console.info; console.info = logSpy;
    try { await createInvitation(admin, { email, roleId: role.id }); } finally { console.info = orig; }
    const token = /\/invitation\/([\w-]+)/.exec(sentLink)?.[1];
    expect(token).toBeTruthy();

    const preview = await previewInvitation(token!);
    expect(preview).toMatchObject({ email, roleName: "Commercial", userExists: false });

    const res = await acceptInvitation({ token: token!, name: "Nouveau", password: "Passw0rd!Test" });
    const m = await platformDb.companyMembership.findUniqueOrThrow({ where: { userId_companyId: { userId: res.userId, companyId: company.id } } });
    expect(m.roleId).toBe(role.id);
    // jeton à usage unique
    await expect(acceptInvitation({ token: token!, name: "X", password: "Passw0rd!Test" })).rejects.toThrow();
    expect(await previewInvitation(token!)).toBeNull();
  });

  it("refuse l'acceptation par un autre utilisateur connecté et respecte la limite d'utilisateurs", async () => {
    const { company, owner } = await makeCompany("InvLim", "starter");
    const admin = await ctxFor(owner.id, company.id);
    const role = await platformDb.role.findFirstOrThrow({ where: { companyId: company.id, templateKey: "viewer" } });
    const existing = await addMember((await makeCompany("Other")).company.id, "employee");
    const orig = console.info; let log = ""; console.info = (m: unknown) => { log += String(m); };
    try { await createInvitation(admin, { email: existing.user.email, roleId: role.id }); } finally { console.info = orig; }
    const token = /\/invitation\/([\w-]+)/.exec(log)![1]!;
    await expect(acceptInvitation({ token, currentUserId: owner.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ok = await acceptInvitation({ token, currentUserId: existing.user.id });
    expect(ok.companyId).toBe(company.id);

    // plan Starter : 5 utilisateurs max (1 propriétaire + 1 invité accepté = 2) → on remplit jusqu'à 5
    for (let i = 0; i < 3; i++) await addMember(company.id, "viewer");
    await expect(createInvitation(admin, { email: `over-${uid()}@t.local`, roleId: role.id })).rejects.toMatchObject({ code: "LIMIT_REACHED" });
  });
});

describe("accès par module (contexte)", () => {
  it("un module non activé est refusé même pour un administrateur ; les permissions du cœur restent accessibles", async () => {
    const { company, owner } = await makeCompany("Mod", "starter"); // Starter : pas de finance ni stock avancé
    const ctx = await ctxFor(owner.id, company.id);
    expect(ctx.hasModule("finance")).toBe(false);
    expect(ctx.can("finance.expense.read")).toBe(false);
    expect(() => ctx.assertCan("finance.expense.read")).toThrowError(/pas activé/);
    expect(() => ctx.assertModule("hr")).toThrow();
    expect(ctx.can("settings.company.update")).toBe(true);
    expect(ctx.hasModule("sales")).toBe(true);
    expect(ctx.can("finance.invoice.create")).toBe(true); // factures = module Ventes
  });

  it("les permissions inconnues lèvent une erreur de programmation (pas un accès silencieux)", async () => {
    const { company, owner } = await makeCompany("Unk");
    const ctx = await ctxFor(owner.id, company.id);
    expect(() => ctx.assertCan("n.existe.pas")).toThrow(/inconnue/);
  });
});
