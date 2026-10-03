import "server-only";
import { platformDb } from "@/core/db/client";

/** L'utilisateur est-il membre ACTIF d'une entreprise ACTIVE ? (contrôle d'accès aux fichiers de l'entreprise) */
export async function isActiveMember(userId: string, companyId: string): Promise<boolean> {
  const m = await platformDb.companyMembership.findUnique({
    where: { userId_companyId: { userId, companyId } },
    select: { status: true, company: { select: { status: true, deletedAt: true } } },
  });
  return Boolean(m && m.status === "ACTIVE" && m.company.status === "ACTIVE" && !m.company.deletedAt);
}
