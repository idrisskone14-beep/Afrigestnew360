import type { Metadata } from "next";
import { listSessions } from "@/core/auth/service";
import { requireUser } from "@/core/tenant/guards";
import { PasswordCard, SessionsCard, TwoFactorCard } from "./security-cards";

export const metadata: Metadata = { title: "Paramètres — Sécurité" };

const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

function describeAgent(ua: string | null): string {
  if (!ua) return "Appareil inconnu";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navigateur";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} sur ${os}` : browser;
}

export default async function SecurityPage() {
  const session = await requireUser();
  const sessions = await listSessions(session.user.id);
  return (
    <div className="grid max-w-3xl gap-6">
      <PasswordCard />
      <TwoFactorCard enabled={session.user.twoFactorEnabled} />
      <SessionsCard
        currentSessionId={session.sessionId}
        sessions={sessions.map((s) => ({
          id: s.id, device: describeAgent(s.userAgent), ip: s.ip ?? "—", lastSeen: fmt.format(s.lastSeenAt), created: fmt.format(s.createdAt),
        }))}
      />
    </div>
  );
}
