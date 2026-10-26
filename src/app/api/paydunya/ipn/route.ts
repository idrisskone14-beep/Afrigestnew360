import { NextResponse, type NextRequest } from "next/server";
import { parseIpnToken } from "@/modules/billing/paydunya";
import { settlePayment } from "@/modules/platform/billing";

/**
 * Notification de paiement PayDunya (IPN, `callback_url`). Appelée par PayDunya, sans session : rien dans la requête n'est cru.
 * Elle ne fournit qu'un jeton de facture ; `settlePayment` retrouve le paiement EN ATTENTE correspondant, relit son état
 * auprès de PayDunya (clés secrètes) et n'active l'abonnement qu'une fois, après contrôle du montant. Un jeton inconnu est
 * ignoré en silence (même réponse) pour ne rien révéler.
 */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = (await req.text()).slice(0, 20_000);
  const token = parseIpnToken(body, req.headers.get("content-type"));
  if (token) {
    try {
      await settlePayment({ token });
    } catch (e) {
      console.error("[paydunya:ipn]", e);
      return NextResponse.json({ ok: false }, { status: 500 }); // erreur transitoire : PayDunya pourra renvoyer la notification
    }
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
