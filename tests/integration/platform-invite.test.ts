import { afterEach, describe, expect, it, vi } from "vitest";
import { platformDb } from "@/core/db/client";
import { acceptInvitation, previewInvitation } from "@/core/tenant/invitations";
import { inviteCompanyMember, revokeCompanyInvitation, setCompanyStatus } from "@/modules/platform/companies";
import { addMember, makeCompany, uid } from "../helpers";

const inviter = async () => {
  const u = await platformDb.user.create({ data: { email: `admin-${uid()}@plateforme.test`, name: "Admin Plateforme", passwordHash: "x", isPlatformAdmin: true } });
  return { id: u.id, name: u.name };
};
const roleOf = (companyId: string, templateKey: string) => platformDb.role.findFirstOrThrow({ where: { companyId, templateKey } });
const tokenOf = (link: string) => /\/invitation\/([\w-]+)/.exec(link)![1]!;

/** Capture l'e-mail « affiché en console » (sans clé Resend) pendant l'appel. */
async function withMailCapture<T>(fn: () => Promise<T>): Promise<{ value: T; mail: string }> {
  const orig = console.info;
  let mail = "";
  console.info = (m: unknown) => { mail += String(m); };
  try { return { value: await fn(), mail }; } finally { console.info = orig; }
}

describe("invitation d'un utilisateur par le Super Admin", () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.RESEND_API_KEY; });

  it("crée l'invitation avec le rôle choisi, envoie le lien par e-mail, et la personne active son compte (e-mail vérifié)", async () => {
    const { company } = await makeCompany("INVSA", "business");
    const admin = await inviter();
    const role = await roleOf(company.id, "accountant");
    const email = `Awa.${uid()}@Entreprise.TEST`; // casse mixte : l'identifiant est normalisé

    const { value: r, mail } = await withMailCapture(() => inviteCompanyMember(company.id, { email, roleId: role.id }, admin));
    expect(r.emailSent).toBe(true);
    expect(r.email).toBe(email.toLowerCase());
    expect(mail).toContain(r.link); // le lien figure dans l'e-mail envoyé à la personne
    expect(mail).toContain(`« ${role.name} »`);
    expect(r.invitation.invitedById).toBe(admin.id);

    // le jeton n'est jamais stocké en clair
    expect(JSON.stringify(await platformDb.invitation.findUniqueOrThrow({ where: { id: r.invitation.id } }))).not.toContain(tokenOf(r.link));

    expect(await previewInvitation(tokenOf(r.link))).toMatchObject({ email: email.toLowerCase(), roleName: role.name, userExists: false });
    const res = await acceptInvitation({ token: tokenOf(r.link), name: "Awa Traoré", password: "Passw0rd!Test" });
    const user = await platformDb.user.findUniqueOrThrow({ where: { id: res.userId } });
    expect(user.email).toBe(email.toLowerCase());
    expect(user.emailVerifiedAt).not.toBeNull(); // ouvrir le lien reçu par e-mail = adresse confirmée
    const m = await platformDb.companyMembership.findUniqueOrThrow({ where: { userId_companyId: { userId: user.id, companyId: company.id } } });
    expect(m.roleId).toBe(role.id);
    // lien à usage unique
    await expect(acceptInvitation({ token: tokenOf(r.link), name: "X", password: "Passw0rd!Test" })).rejects.toThrow();
  });

  it("si l'e-mail ne peut pas partir, l'invitation existe quand même et le lien est remis au Super Admin", async () => {
    const { company } = await makeCompany("INVMAIL", "business");
    const role = await roleOf(company.id, "viewer");
    process.env.RESEND_API_KEY = "re_test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("domaine non vérifié", { status: 403 })));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const r = await inviteCompanyMember(company.id, { email: `mail-${uid()}@t.local`, roleId: role.id }, await inviter());
      expect(r.emailSent).toBe(false);
      expect(await previewInvitation(tokenOf(r.link))).not.toBeNull(); // le lien fonctionne
    } finally { err.mockRestore(); }
  });

  it("renvoyer remplace l'invitation précédente : l'ancien lien cesse de fonctionner", async () => {
    const { company } = await makeCompany("INVRE", "business");
    const admin = await inviter();
    const role = await roleOf(company.id, "sales_rep");
    const email = `re-${uid()}@t.local`;
    const { value: first } = await withMailCapture(() => inviteCompanyMember(company.id, { email, roleId: role.id }, admin));
    const { value: second } = await withMailCapture(() => inviteCompanyMember(company.id, { email, roleId: role.id }, admin));
    expect(await previewInvitation(tokenOf(first.link))).toBeNull();
    expect(await previewInvitation(tokenOf(second.link))).not.toBeNull();
    expect(await platformDb.invitation.count({ where: { companyId: company.id, email, acceptedAt: null, revokedAt: null } })).toBe(1);
  });

  it("annuler une invitation désactive son lien ; une invitation d'une autre entreprise ne peut pas être annulée", async () => {
    const A = await makeCompany("INVA", "business");
    const B = await makeCompany("INVB", "business");
    const admin = await inviter();
    const role = await roleOf(A.company.id, "viewer");
    const { value: inv } = await withMailCapture(() => inviteCompanyMember(A.company.id, { email: `rev-${uid()}@t.local`, roleId: role.id }, admin));
    await expect(revokeCompanyInvitation(B.company.id, inv.invitation.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await previewInvitation(tokenOf(inv.link))).not.toBeNull();
    await revokeCompanyInvitation(A.company.id, inv.invitation.id);
    expect(await previewInvitation(tokenOf(inv.link))).toBeNull();
    await expect(revokeCompanyInvitation(A.company.id, inv.invitation.id)).rejects.toMatchObject({ code: "NOT_FOUND" }); // déjà annulée
  });

  it("refuse : rôle d'une autre entreprise, membre déjà présent, entreprise suspendue", async () => {
    const A = await makeCompany("INVR1", "business");
    const B = await makeCompany("INVR2", "business");
    const admin = await inviter();
    const roleB = await roleOf(B.company.id, "viewer");
    await expect(inviteCompanyMember(A.company.id, { email: `x-${uid()}@t.local`, roleId: roleB.id }, admin)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const member = await addMember(A.company.id, "employee");
    await expect(inviteCompanyMember(A.company.id, { email: member.user.email.toUpperCase(), roleId: (await roleOf(A.company.id, "viewer")).id }, admin)).rejects.toMatchObject({ code: "CONFLICT" });

    await setCompanyStatus(A.company.id, "SUSPENDED", "test");
    await expect(inviteCompanyMember(A.company.id, { email: `y-${uid()}@t.local`, roleId: (await roleOf(A.company.id, "viewer")).id }, admin)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("suspendue") });
    await setCompanyStatus(A.company.id, "ACTIVE");
  });

  it("respecte la limite d'utilisateurs de l'offre et indique où l'augmenter ; un renvoi ne compte pas deux fois", async () => {
    const { company } = await makeCompany("INVLIM", "starter"); // Starter : 5 utilisateurs (1 propriétaire déjà présent)
    const admin = await inviter();
    const role = await roleOf(company.id, "viewer");
    for (let i = 0; i < 3; i++) await addMember(company.id, "viewer"); // 4 sur 5
    const email = `last-${uid()}@t.local`;
    await withMailCapture(() => inviteCompanyMember(company.id, { email, roleId: role.id }, admin)); // 5e : en attente, compte dans la limite
    await withMailCapture(() => inviteCompanyMember(company.id, { email, roleId: role.id }, admin)); // renvoi : remplace, pas de 6e
    await expect(inviteCompanyMember(company.id, { email: `over-${uid()}@t.local`, roleId: role.id }, admin))
      .rejects.toMatchObject({ code: "LIMIT_REACHED", message: expect.stringContaining("onglet « Limites »") });
  });
});
