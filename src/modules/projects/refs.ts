import "server-only";
import type { Db } from "@/core/db/client";
import { businessRule, notFound } from "@/core/errors";

/** Vérifie qu'un projet existe dans l'entreprise et accepte encore des rattachements (non annulé). Sans dépendance vers les autres modules. */
export async function assertProject(db: Pick<Db, "project">, id?: string | null) {
  if (!id) return;
  const p = await db.project.findFirst({ where: { id, deletedAt: null }, select: { status: true } });
  if (!p) throw notFound("Projet");
  if (p.status === "CANCELLED") throw businessRule("Ce projet est annulé : on ne peut plus lui rattacher de documents.");
}
