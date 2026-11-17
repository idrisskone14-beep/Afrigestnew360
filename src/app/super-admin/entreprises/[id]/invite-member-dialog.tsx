"use client";

import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Copy, TriangleAlert, UserPlus } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormAlert, SubmitButton, applyServerErrors } from "@/components/app/form-kit";
import { inviteCompanyMemberAction } from "@/modules/platform/actions";
import { inviteMemberSchema } from "@/modules/platform/schemas";

export interface RoleOption { id: string; name: string; isAdmin: boolean }
/** Résultat d'une invitation : le lien d'activation n'est montré qu'à l'administrateur de la plateforme qui vient de la créer. */
export interface InviteResult { link: string; emailSent: boolean; email: string; roleName: string }

const formSchema = inviteMemberSchema.omit({ companyId: true });
type Values = z.input<typeof formSchema>;

/** Bouton « Ajouter un utilisateur » : l'adresse e-mail devient l'identifiant du compte, le rôle fixe ses droits dans l'entreprise. */
export function InviteMemberDialog({ companyId, roles, disabled, onInvited }: { companyId: string; roles: RoleOption[]; disabled?: boolean; onInvited: (r: InviteResult) => void }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, control, handleSubmit, setError, reset, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", roleId: "" },
  });
  const roleId = useWatch({ control, name: "roleId" });
  const chosen = roles.find((r) => r.id === roleId);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setFormError(null); }}>
      <DialogTrigger asChild>
        <Button disabled={disabled} title={disabled ? "Réactivez l'entreprise pour y inviter des utilisateurs" : undefined}><UserPlus className="size-4" /> Ajouter un utilisateur</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ajouter un utilisateur</DialogTitle>
          <DialogDescription>
            Son adresse e-mail sera son identifiant. Il recevra un e-mail : en ouvrant le lien, il confirme son adresse et choisit son mot de passe.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={handleSubmit((v) => start(async () => {
            setFormError(null);
            const res = await inviteCompanyMemberAction({ companyId, email: v.email, roleId: v.roleId });
            if (!res.ok) return setFormError(applyServerErrors(res.error, setError));
            setOpen(false);
            reset();
            onInvited(res.data);
          }))}
        >
          <FormAlert message={formError} />
          <Field label="Adresse e-mail de la personne" htmlFor="inv-email" error={errors.email?.message}>
            <Input id="inv-email" type="email" autoComplete="off" placeholder="prenom.nom@entreprise.com" {...register("email")} autoFocus />
          </Field>
          <Field label="Rôle dans l'entreprise" error={errors.roleId?.message} hint={chosen ? (chosen.isAdmin ? "Accès complet à toute l'entreprise, y compris la gestion des utilisateurs." : "Les droits de ce rôle peuvent être ajustés ensuite par l'administrateur de l'entreprise.") : undefined}>
            <Controller control={control} name="roleId" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full" aria-label="Rôle dans l'entreprise"><SelectValue placeholder="Choisir un rôle" /></SelectTrigger>
                <SelectContent>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}{r.isAdmin ? " (accès complet)" : ""}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </Field>
          <SubmitButton pending={pending}>Envoyer l'invitation</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Confirmation après l'envoi : rappelle ce que la personne doit faire, et donne le lien à transmettre si l'e-mail n'est pas parti. */
export function InvitationResultDialog({ result, onClose }: { result: InviteResult | null; onClose: () => void }) {
  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.link);
      toast.success("Lien copié");
    } catch {
      toast.error("Copie impossible : sélectionnez le lien et copiez-le à la main.");
    }
  };

  return (
    <Dialog open={result !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        {result && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {result.emailSent ? <CheckCircle2 className="size-5 text-success" aria-hidden="true" /> : <TriangleAlert className="size-5 text-warning" aria-hidden="true" />}
                {result.emailSent ? "Invitation envoyée" : "Invitation créée, e-mail non envoyé"}
              </DialogTitle>
              <DialogDescription>
                {result.emailSent
                  ? <>Un e-mail a été envoyé à <strong>{result.email}</strong> (rôle « {result.roleName} »). La personne doit ouvrir le lien qu'il contient pour confirmer son adresse et choisir son mot de passe, dans les 7 jours.</>
                  : <>L'e-mail n'a pas pu partir (l'envoi des e-mails n'est peut-être pas encore configuré). L'invitation de <strong>{result.email}</strong> (rôle « {result.roleName} ») existe bien : transmettez-lui ce lien vous-même, par exemple sur WhatsApp. Il est valable 7 jours.</>}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <label htmlFor="inv-link" className="text-sm font-medium">{result.emailSent ? "Si l'e-mail n'arrive pas, vous pouvez lui transmettre ce lien :" : "Lien d'activation"}</label>
              <div className="flex gap-2">
                <Input id="inv-link" readOnly value={result.link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
                <Button type="button" variant="outline" onClick={copy}><Copy className="size-4" /> Copier</Button>
              </div>
              <p className="text-xs text-muted-foreground">Ce lien donne accès à l'entreprise : ne le publiez pas. Il cesse de fonctionner dès qu'il est utilisé ou que l'invitation est annulée.</p>
            </div>
            <Button onClick={onClose}>Terminé</Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
