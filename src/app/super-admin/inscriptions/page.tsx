import type { Metadata } from "next";
import { Check, MailCheck, ShieldCheck, UserCheck, X } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSignupMode } from "@/core/platform-settings";
import { approveRegistrationAction, rejectRegistrationAction, setSignupModeAction } from "@/modules/platform/actions";
import { listPendingRegistrations } from "@/modules/platform/registrations";

export const metadata: Metadata = { title: "Inscriptions" };

const dt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

export default async function RegistrationsPage() {
  const [mode, pending] = await Promise.all([getSignupMode(), listPendingRegistrations()]);
  const approval = mode === "approval";

  return (
    <>
      <PageHeader
        title="Inscriptions"
        description="Choisissez comment les nouveaux utilisateurs obtiennent leur accès : confirmation par e-mail, ou validation par vous."
      />

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Mode d&apos;inscription
            <Badge variant={approval ? "default" : "secondary"}>{approval ? "Validation par le Super Admin" : "Confirmation par e-mail"}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={`rounded-lg border p-4 ${!approval ? "border-brand bg-accent/50" : ""}`}>
              <p className="flex items-center gap-2 font-medium"><MailCheck className="size-4" /> Confirmation par e-mail</p>
              <p className="mt-1 text-sm text-muted-foreground">L&apos;inscrit reçoit un lien et active lui-même son compte. Nécessite que l&apos;envoi d&apos;e-mails soit configuré (Resend).</p>
            </div>
            <div className={`rounded-lg border p-4 ${approval ? "border-brand bg-accent/50" : ""}`}>
              <p className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4" /> Validation par le Super Admin</p>
              <p className="mt-1 text-sm text-muted-foreground">Aucun e-mail requis. Le compte reste « en attente » et ne peut pas se connecter tant que vous ne l&apos;avez pas validé ci-dessous.</p>
            </div>
          </div>
          <div>
            <ActionButton
              action={setSignupModeAction}
              input={{ mode: approval ? "email" : "approval" }}
              variant={approval ? "outline" : "default"}
              label={approval ? "Revenir à la confirmation par e-mail" : "Passer en validation par le Super Admin"}
              success="Mode d'inscription mis à jour."
              confirm={{
                title: approval ? "Revenir à la confirmation par e-mail ?" : "Passer en validation par le Super Admin ?",
                description: approval
                  ? "Les prochaines inscriptions devront confirmer leur adresse par e-mail. Les comptes déjà en attente restent à traiter ici."
                  : "Les prochaines inscriptions seront mises en attente jusqu'à votre validation. Les comptes existants ne sont pas touchés.",
                confirmLabel: "Confirmer",
              }}
            />
          </div>
        </CardContent>
      </Card>

      <h2 className="mb-3 flex items-center gap-2 text-xl font-semibold">
        En attente de validation
        <Badge variant={pending.length > 0 ? "default" : "secondary"}>{pending.length}</Badge>
      </h2>
      {pending.length === 0 ? (
        <EmptyState
          icon={<UserCheck className="size-8" />}
          title="Aucune inscription en attente"
          description={approval ? "Les nouvelles inscriptions apparaîtront ici dès qu'elles seront envoyées." : "En mode « confirmation par e-mail », les inscriptions ne passent pas par cette liste."}
        />
      ) : (
        <div className="grid gap-3">
          {pending.map((u) => (
            <Card key={u.id} className="gap-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{u.name}</p>
                  <p className="text-sm text-muted-foreground"><a href={`mailto:${u.email}`} className="hover:text-foreground">{u.email}</a> · inscrit le {dt.format(u.createdAt)}</p>
                </div>
                <div className="flex gap-2">
                  <ActionButton
                    action={approveRegistrationAction}
                    input={{ userId: u.id }}
                    label="Valider"
                    icon={<Check className="size-4" />}
                    variant="default"
                    success={`${u.name} peut maintenant se connecter.`}
                  />
                  <ActionButton
                    action={rejectRegistrationAction}
                    input={{ userId: u.id }}
                    label="Refuser"
                    icon={<X className="size-4" />}
                    success="Inscription refusée."
                    confirm={{ title: `Refuser l'inscription de ${u.name} ?`, description: "Le compte sera désactivé : il ne pourra ni se connecter ni se réinscrire avec cette adresse.", confirmLabel: "Refuser" }}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
