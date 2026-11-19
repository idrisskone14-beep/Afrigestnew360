"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BadgeCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Field, FormAlert } from "@/components/app/form-kit";
import { certifyInvoiceAction, saveFneSettingsAction } from "./actions";
import { FNE_PAYMENT_LABELS, FNE_PAYMENT_VALUES, FNE_TEMPLATE_LABELS, FNE_TEMPLATE_VALUES, type FnePaymentMethod, type FneTemplate } from "./schemas";

const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);

/** Type de client et mode de paiement déclarés à la FNE (émission et certification d'une facture). */
export function FneInvoiceFields({ template, payment, onTemplate, onPayment, idPrefix }: { template: FneTemplate; payment: FnePaymentMethod; onTemplate: (v: FneTemplate) => void; onPayment: (v: FnePaymentMethod) => void; idPrefix: string }) {
  return (
    <div className="grid gap-3 rounded-lg border border-brand/30 bg-brand/5 p-3 sm:grid-cols-2">
      <p className="flex items-center gap-1.5 text-sm font-medium sm:col-span-2"><ShieldCheck className="size-4 text-brand" /> Certification FNE (DGI)</p>
      <Field label="Type de client" htmlFor={`${idPrefix}-tpl`} hint="B2B exige le NCC du client.">
        <Select value={template} onValueChange={(v) => onTemplate(v as FneTemplate)}>
          <SelectTrigger id={`${idPrefix}-tpl`}><SelectValue /></SelectTrigger>
          <SelectContent>{FNE_TEMPLATE_VALUES.map((v) => <SelectItem key={v} value={v}>{FNE_TEMPLATE_LABELS[v]}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Mode de paiement" htmlFor={`${idPrefix}-pay`}>
        <Select value={payment} onValueChange={(v) => onPayment(v as FnePaymentMethod)}>
          <SelectTrigger id={`${idPrefix}-pay`}><SelectValue /></SelectTrigger>
          <SelectContent>{FNE_PAYMENT_VALUES.map((v) => <SelectItem key={v} value={v}>{FNE_PAYMENT_LABELS[v]}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
    </div>
  );
}

/** Certification (ou nouvelle tentative) d'une facture déjà émise. */
export function CertifyInvoiceDialog({ id, template: t0, payment: p0, uncertain, retry }: { id: string; template: FneTemplate; payment: FnePaymentMethod; uncertain: boolean; retry: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState(t0);
  const [payment, setPayment] = useState(p0);
  const [checked, setChecked] = useState(false);

  const submit = () => start(async () => {
    setError(null);
    if (uncertain && !checked) return setError("Confirmez d'abord que la facture n'apparaît pas dans votre espace FNE.");
    const res = await certifyInvoiceAction({ id, template, paymentMethod: payment });
    router.refresh();
    if (!res.ok) return setError(errText(res.error));
    toast.success(`Facture certifiée FNE (n° ${res.data.reference})`);
    if (res.data.stickerWarning) toast.warning("Stock de stickers FNE bientôt épuisé : rechargez-le depuis votre espace FNE.");
    setOpen(false);
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild><Button variant={retry ? "outline" : "default"}><BadgeCheck className="size-4" /> {retry ? "Relancer la certification FNE" : "Certifier auprès de la FNE"}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Certification FNE</DialogTitle>
          <DialogDescription>La facture est transmise à la plateforme de la DGI, qui lui attribue un numéro FNE et un QR code de vérification imprimés sur le PDF.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={error} />
          {uncertain && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <p>La tentative précédente n&apos;a pas reçu de réponse : la facture a <strong>peut-être déjà été certifiée</strong>. Vérifiez dans votre espace FNE avant de recommencer, sinon elle serait certifiée deux fois.</p>
              <label className="mt-2 flex items-center gap-2"><Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} /> J&apos;ai vérifié : elle n&apos;y figure pas.</label>
            </div>
          )}
          <FneInvoiceFields idPrefix="cf" template={template} payment={payment} onTemplate={setTemplate} onPayment={setPayment} />
          <Button disabled={pending} onClick={submit}>{pending ? "Certification en cours…" : "Certifier"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface FneSettingsView {
  enabled: boolean; environment: "test" | "production"; hasKey: boolean; apiKeyHint: string | null; pointOfSale: string; establishment: string; commercialMessage: string; footer: string;
  autoCertify: boolean; exemptTaxCode: "TVAC" | "TVAD"; stickerBalance: number | null; stickerWarning: boolean; stickerCheckedAt: string | null; prodUrlConfigured: boolean; currencyOk: boolean;
}

export function FneSettingsForm({ initial, canManage }: { initial: FneSettingsView; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ ...initial, apiKey: "" });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(null);
      const res = await saveFneSettingsAction({
        enabled: f.enabled, environment: f.environment, apiKey: f.apiKey, pointOfSale: f.pointOfSale, establishment: f.establishment,
        commercialMessage: f.commercialMessage, footer: f.footer, autoCertify: f.autoCertify, exemptTaxCode: f.exemptTaxCode,
      });
      if (!res.ok) return setError(errText(res.error));
      toast.success("Raccordement FNE enregistré");
      setF((s) => ({ ...s, apiKey: "" }));
      router.refresh();
    });
  };

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-[1fr_320px]">
      <form onSubmit={submit} className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Raccordement à la plateforme FNE</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <FormAlert message={error} />
            {!initial.currencyOk && <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">La FNE ne certifie que des factures en francs CFA (XOF) : la devise de cette entreprise ne le permet pas.</p>}
            <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <span><span className="block text-sm font-medium">Certification FNE active</span><span className="block text-xs text-muted-foreground">Chaque facture et chaque avoir émis peuvent être certifiés par la DGI.</span></span>
              <Switch checked={f.enabled} disabled={!canManage} onCheckedChange={(v) => set("enabled", v)} aria-label="Certification FNE active" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Environnement" htmlFor="fne-env" hint={f.environment === "test" ? "Factures de test : aucune valeur fiscale." : initial.prodUrlConfigured ? "Factures réelles, déclarées à la DGI." : "URL de production non configurée sur la plateforme (FNE_PROD_URL)."}>
                <Select value={f.environment} disabled={!canManage} onValueChange={(v) => set("environment", v as "test" | "production")}>
                  <SelectTrigger id="fne-env"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="test">Test (environnement DGI)</SelectItem><SelectItem value="production">Production</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="Clé API" htmlFor="fne-key" hint={initial.hasKey ? `Clé enregistrée (…${initial.apiKeyHint ?? ""}) : laissez vide pour la conserver.` : "Espace FNE → onglet « Paramétrage » (gestionnaire principal)."}>
                <Input id="fne-key" type="password" autoComplete="off" spellCheck={false} disabled={!canManage} value={f.apiKey} onChange={(e) => set("apiKey", e.target.value)} placeholder={initial.hasKey ? "•••••••• (inchangée)" : ""} />
              </Field>
              <Field label="Point de vente" htmlFor="fne-pos" hint="Tel que déclaré dans votre espace FNE.">
                <Input id="fne-pos" disabled={!canManage} value={f.pointOfSale} onChange={(e) => set("pointOfSale", e.target.value)} maxLength={100} />
              </Field>
              <Field label="Établissement" htmlFor="fne-est" hint="Tel que déclaré dans votre espace FNE.">
                <Input id="fne-est" disabled={!canManage} value={f.establishment} onChange={(e) => set("establishment", e.target.value)} maxLength={150} />
              </Field>
              <Field label="Message commercial (facultatif)" htmlFor="fne-msg">
                <Input id="fne-msg" disabled={!canManage} value={f.commercialMessage} onChange={(e) => set("commercialMessage", e.target.value)} maxLength={300} />
              </Field>
              <Field label="Message de pied de facture (facultatif)" htmlFor="fne-foot">
                <Input id="fne-foot" disabled={!canManage} value={f.footer} onChange={(e) => set("footer", e.target.value)} maxLength={300} />
              </Field>
              <Field label="Lignes à TVA 0 %" htmlFor="fne-exempt" hint="Code FNE appliqué aux lignes exonérées.">
                <Select value={f.exemptTaxCode} disabled={!canManage} onValueChange={(v) => set("exemptTaxCode", v as "TVAC" | "TVAD")}>
                  <SelectTrigger id="fne-exempt"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="TVAD">TVAD — exonération légale</SelectItem><SelectItem value="TVAC">TVAC — exonération conventionnelle</SelectItem></SelectContent>
                </Select>
              </Field>
            </div>
            <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <span><span className="block text-sm font-medium">Certifier automatiquement à l&apos;émission</span><span className="block text-xs text-muted-foreground">Sinon, la certification se lance depuis la fiche de chaque facture ou avoir.</span></span>
              <Switch checked={f.autoCertify} disabled={!canManage} onCheckedChange={(v) => set("autoCertify", v)} aria-label="Certifier automatiquement à l'émission" />
            </label>
            {canManage ? <Button type="submit" disabled={pending} className="justify-self-start">{pending ? "Enregistrement…" : "Enregistrer"}</Button> : <p className="text-sm text-muted-foreground">Seuls les utilisateurs autorisés à modifier les paramètres de l&apos;entreprise peuvent changer ce raccordement.</p>}
          </CardContent>
        </Card>
      </form>

      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Stickers électroniques</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {initial.stickerBalance === null ? <p className="text-muted-foreground">Le solde s&apos;affiche après la première certification.</p> : (
              <>
                <p className="text-2xl font-semibold tabular">{initial.stickerBalance}</p>
                <p className="text-muted-foreground">restants{initial.stickerCheckedAt ? ` au ${new Date(initial.stickerCheckedAt).toLocaleDateString("fr-FR")}` : ""}</p>
                {initial.stickerWarning && <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2">Stock bientôt épuisé : rechargez-le depuis votre espace FNE.</p>}
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Mise en service</CardTitle></CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-1.5 pl-4 text-sm text-muted-foreground">
              <li>Inscrivez l&apos;entreprise sur l&apos;environnement de test FNE de la DGI et copiez la clé API ici (environnement « Test »).</li>
              <li>Émettez des factures, avoirs et factures B2B/B2C de test, puis téléchargez leurs PDF.</li>
              <li>Envoyez ces spécimens à <span className="text-foreground">support.fne@dgi.gouv.ci</span>.</li>
              <li>Après validation, la DGI donne accès à la clé de production : saisissez-la et passez en « Production ».</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
