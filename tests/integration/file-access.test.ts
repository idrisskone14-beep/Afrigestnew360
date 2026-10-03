import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { isActiveMember } from "@/core/tenant/access";
import { setCompanyStatus } from "@/modules/platform/companies";
import { addMember, makeCompany, makeUser } from "../helpers";

/** La route /api/files/logo/[companyId] ne sert un fichier qu'aux membres actifs d'une entreprise active. */
describe("accès aux fichiers d'une entreprise", () => {
  it("membre actif : oui ; étranger : non", async () => {
    const A = await makeCompany("FA");
    const outsider = await makeUser();
    expect(await isActiveMember(A.owner.id, A.company.id)).toBe(true);
    expect(await isActiveMember(outsider.id, A.company.id)).toBe(false);
  });

  it("l'appartenance à l'entreprise B ne donne aucun accès aux fichiers de A", async () => {
    const A = await makeCompany("FA2");
    const B = await makeCompany("FB2");
    expect(await isActiveMember(B.owner.id, A.company.id)).toBe(false);
  });

  it("membre suspendu ou entreprise suspendue : non", async () => {
    const A = await makeCompany("FA3");
    const m = await addMember(A.company.id, "employee");
    expect(await isActiveMember(m.user.id, A.company.id)).toBe(true);
    await platformDb.companyMembership.update({ where: { id: m.membership.id }, data: { status: "SUSPENDED" } });
    expect(await isActiveMember(m.user.id, A.company.id)).toBe(false);
    await setCompanyStatus(A.company.id, "SUSPENDED");
    expect(await isActiveMember(A.owner.id, A.company.id)).toBe(false);
  });
});
