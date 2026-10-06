import { NextResponse } from "next/server";
import { canSeeValidations, pendingDecisionCount } from "@/core/approvals";
import { loadContextState } from "@/core/tenant/context";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Compteurs de la barre latérale (notifications non lues, validations en attente) pour l'utilisateur et l'entreprise ACTIFS.
 * Authentification et appartenance revérifiées à chaque appel (même contexte que les pages) ; ne renvoie que deux nombres.
 */
export async function GET() {
  const state = await loadContextState();
  if (state.status !== "ok") return NextResponse.json({ unread: 0, pending: 0 }, { status: 401, headers: NO_STORE });
  const { ctx } = state;
  const [unread, pending] = await Promise.all([
    ctx.db.notification.count({ where: { userId: ctx.user.id, status: "UNREAD" } }),
    canSeeValidations(ctx) ? pendingDecisionCount(ctx) : Promise.resolve(0),
  ]);
  return NextResponse.json({ unread, pending }, { headers: NO_STORE });
}
