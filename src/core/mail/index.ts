import "server-only";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Envoi d'e-mails. Avec RESEND_API_KEY → API Resend. Sans clé (développement) → affichage console,
 * ce qui permet de récupérer les liens de vérification / réinitialisation / invitation.
 */
export async function sendMail(msg: MailMessage): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(`\n[mail:dev] À: ${msg.to}\n[mail:dev] Sujet: ${msg.subject}\n${msg.text}\n`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM ?? "AfriGest 360 <no-reply@afrigest360.com>",
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    }),
  });
  if (!res.ok) {
    console.error("[mail] échec d'envoi", res.status, await res.text().catch(() => ""));
    throw new Error("Impossible d'envoyer l'e-mail.");
  }
}

export const appUrl = (path = "") => `${process.env.APP_URL ?? "http://localhost:3000"}${path}`;
