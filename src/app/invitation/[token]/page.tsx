import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { getCurrentSession } from "@/core/auth/session";
import { previewInvitation } from "@/core/tenant/invitations";
import { InvitationForm } from "./invitation-form";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invitation, session] = await Promise.all([previewInvitation(token), getCurrentSession()]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <Link href="/" className="mb-8"><Logo /></Link>
      {!invitation ? (
        <div className="rounded-xl border bg-card p-6">
          <h1 className="text-lg font-semibold">Invitation invalide</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Ce lien a expiré, a déjà été utilisé ou a été révoqué. Demandez une nouvelle invitation à votre administrateur.</p>
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Rejoindre {invitation.companyName}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Vous êtes invité(e) avec le rôle <strong>{invitation.roleName}</strong> ({invitation.email}).
          </p>
          <div className="mt-6">
            <InvitationForm
              token={token}
              email={invitation.email}
              userExists={invitation.userExists}
              signedInAs={session?.user.email ?? null}
            />
          </div>
        </>
      )}
    </main>
  );
}
