"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Laptop, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, FormAlert, SubmitButton, applyServerErrors, runAction } from "@/components/app/form-kit";
import { changePasswordSchema } from "@/core/auth/schemas";
import {
  beginTwoFactorAction, changePasswordAction, confirmTwoFactorAction, disableTwoFactorAction, revokeOtherSessionsAction, revokeSessionAction,
} from "@/modules/settings/actions";

type PwValues = z.input<typeof changePasswordSchema>;

export function PasswordCard() {
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, reset, formState: { errors } } = useForm<PwValues>({ resolver: zodResolver(changePasswordSchema) });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Mot de passe</CardTitle><CardDescription>Changer votre mot de passe déconnecte vos autres appareils.</CardDescription></CardHeader>
      <CardContent>
        <form
          noValidate
          className="grid max-w-md gap-4"
          onSubmit={handleSubmit((v) => start(async () => {
            setFormError(null);
            const res = await changePasswordAction(v);
            if (!res.ok) return setFormError(applyServerErrors(res.error, setError));
            toast.success("Mot de passe modifié");
            reset();
          }))}
        >
          <FormAlert message={formError} />
          <Field label="Mot de passe actuel" htmlFor="cur" error={errors.currentPassword?.message}><Input id="cur" type="password" autoComplete="current-password" {...register("currentPassword")} /></Field>
          <Field label="Nouveau mot de passe" htmlFor="new" hint="10 caractères min., avec majuscule, minuscule et chiffre." error={errors.password?.message}><Input id="new" type="password" autoComplete="new-password" {...register("password")} /></Field>
          <Field label="Confirmer" htmlFor="conf" error={errors.confirmPassword?.message}><Input id="conf" type="password" autoComplete="new-password" {...register("confirmPassword")} /></Field>
          <div><SubmitButton pending={pending}>Changer le mot de passe</SubmitButton></div>
        </form>
      </CardContent>
    </Card>
  );
}

export function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [disableCode, setDisableCode] = useState("");

  const begin = () => start(async () => {
    const res = await runAction(beginTwoFactorAction({}));
    if (res.ok) { setSetup(res.data); setCode(""); setError(null); }
  });
  const confirm = () => start(async () => {
    setError(null);
    const res = await runAction(confirmTwoFactorAction({ code }), { silentError: true });
    if (!res.ok) return setError(res.error.fieldErrors?.code?.[0] ?? res.error.message);
    setSetup(null); setRecovery(res.data.recoveryCodes);
    router.refresh();
  });
  const disable = () => start(async () => {
    setError(null);
    const res = await runAction(disableTwoFactorAction({ password: pw, code: disableCode }), { silentError: true });
    if (!res.ok) return setError(res.error.fieldErrors?.password?.[0] ?? res.error.fieldErrors?.code?.[0] ?? res.error.message);
    toast.success("Authentification à deux facteurs désactivée");
    setDisableOpen(false); setPw(""); setDisableCode("");
    router.refresh();
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Authentification à deux facteurs (2FA)</CardTitle>
          <CardDescription className="mt-1">Protégez votre compte avec un code temporaire (Google Authenticator, Microsoft Authenticator, Authy…).</CardDescription>
        </div>
        {enabled ? <Badge className="bg-success/15 text-success hover:bg-success/15"><ShieldCheck className="size-3.5" /> Activée</Badge> : <Badge variant="secondary"><ShieldOff className="size-3.5" /> Désactivée</Badge>}
      </CardHeader>
      <CardContent>
        {enabled ? (
          <Button variant="outline" onClick={() => { setError(null); setDisableOpen(true); }}>Désactiver la 2FA</Button>
        ) : setup ? (
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <Image src={setup.qrDataUrl} alt="QR code à scanner avec votre application d'authentification" width={176} height={176} unoptimized className="rounded-lg border bg-white p-1" />
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">1. Scannez le QR code (ou saisissez la clé : <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{setup.secret}</code>).<br />2. Entrez le code à 6 chiffres affiché.</p>
              <Field label="Code de vérification" htmlFor="totp-confirm" error={error ?? undefined}>
                <Input id="totp-confirm" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="max-w-40 tracking-widest" autoFocus />
              </Field>
              <div className="flex gap-2">
                <Button disabled={pending || code.length !== 6} onClick={confirm}>Activer</Button>
                <Button variant="ghost" onClick={() => setSetup(null)}>Annuler</Button>
              </div>
            </div>
          </div>
        ) : (
          <Button onClick={begin} disabled={pending}>Configurer la 2FA</Button>
        )}
      </CardContent>

      <Dialog open={recovery !== null} onOpenChange={(o) => !o && setRecovery(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Codes de secours</DialogTitle>
            <DialogDescription>Conservez-les en lieu sûr : chacun ne fonctionne qu'une fois si vous perdez votre téléphone. Ils ne seront plus affichés.</DialogDescription>
          </DialogHeader>
          <ul className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-4 font-mono text-sm">{recovery?.map((c) => <li key={c}>{c}</li>)}</ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(recovery?.join("\n") ?? ""); toast.success("Codes copiés"); }}><Copy className="size-4" /> Copier</Button>
            <Button onClick={() => setRecovery(null)}>J'ai conservé mes codes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Désactiver la 2FA</DialogTitle><DialogDescription>Confirmez avec votre mot de passe et un code actuel (ou un code de secours).</DialogDescription></DialogHeader>
          <div className="grid gap-4">
            <FormAlert message={error} />
            <Field label="Mot de passe" htmlFor="d-pw"><Input id="d-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <Field label="Code" htmlFor="d-code"><Input id="d-code" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisableOpen(false)}>Annuler</Button>
            <Button variant="destructive" disabled={pending || !pw || !disableCode} onClick={disable}>Désactiver</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

interface SessionRow { id: string; device: string; ip: string; lastSeen: string; created: string }

export function SessionsCard({ sessions, currentSessionId }: { sessions: SessionRow[]; currentSessionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const others = sessions.filter((s) => s.id !== currentSessionId).length;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Sessions actives</CardTitle>
          <CardDescription className="mt-1">Appareils actuellement connectés à votre compte. Révoquez ceux que vous ne reconnaissez pas.</CardDescription>
        </div>
        {others > 0 && (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => start(async () => { const r = await runAction(revokeOtherSessionsAction({}), { success: "Autres sessions révoquées" }); if (r.ok) router.refresh(); })}>
            Révoquer les autres
          </Button>
        )}
      </CardHeader>
      <CardContent className="divide-y">
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <Laptop className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{s.device} {s.id === currentSessionId && <Badge variant="secondary" className="ml-1.5">Cet appareil</Badge>}</p>
              <p className="text-xs text-muted-foreground">IP {s.ip} · dernière activité {s.lastSeen}</p>
            </div>
            {s.id !== currentSessionId && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => { const r = await runAction(revokeSessionAction({ sessionId: s.id }), { success: "Session révoquée" }); if (r.ok) router.refresh(); })}>Révoquer</Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
