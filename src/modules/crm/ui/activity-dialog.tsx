"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert, SubmitButton, applyServerErrors } from "@/components/app/form-kit";
import { createActivityAction } from "../actions";
import { ACTIVITY_TYPES, activitySchema } from "../schemas";
import type { z } from "zod";

type Values = z.input<typeof activitySchema>;

/** Création d'une activité (appel, rendez-vous, e-mail, note, tâche/relance), rattachable à un client, prospect ou opportunité. */
export function ActivityDialog({ customerId, leadId, opportunityId, label = "Nouvelle activité" }: { customerId?: string; leadId?: string; opportunityId?: string; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, control, handleSubmit, setError, reset, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(activitySchema),
    defaultValues: { type: "TASK", subject: "", notes: "", dueAt: "", customerId: customerId ?? "", leadId: leadId ?? "", opportunityId: opportunityId ?? "" },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { reset(); setFormError(null); } }}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><Plus className="size-4" /> {label}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nouvelle activité</DialogTitle><DialogDescription>Une tâche ou un rendez-vous avec une date apparaît dans vos relances.</DialogDescription></DialogHeader>
        <form noValidate className="grid gap-4" onSubmit={handleSubmit((v) => start(async () => {
          setFormError(null);
          const payload = { ...v, dueAt: v.dueAt ? new Date(v.dueAt).toISOString() : "" };
          const res = await createActivityAction(payload);
          if (!res.ok) return setFormError(applyServerErrors(res.error, setError));
          toast.success("Activité enregistrée");
          setOpen(false);
          router.refresh();
        }))}>
          <FormAlert message={formError} />
          <Field label="Type" error={errors.type?.message}>
            <Controller control={control} name="type" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{ACTIVITY_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </Field>
          <Field label="Objet *" htmlFor="ac-subject" error={errors.subject?.message}><Input id="ac-subject" autoFocus {...register("subject")} /></Field>
          <Field label="Échéance (optionnel)" htmlFor="ac-due" error={errors.dueAt?.message}><Input id="ac-due" type="datetime-local" {...register("dueAt")} /></Field>
          <Field label="Notes" htmlFor="ac-notes" error={errors.notes?.message}><Textarea id="ac-notes" rows={3} {...register("notes")} /></Field>
          <SubmitButton pending={pending}>Enregistrer</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
