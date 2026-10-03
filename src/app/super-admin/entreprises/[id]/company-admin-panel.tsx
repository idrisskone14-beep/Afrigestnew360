"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PauseCircle, PlayCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert, SubmitButton, applyServerErrors, runAction } from "@/components/app/form-kit";
import { LIMIT_KEYS, UNLIMITED } from "@/core/modules/registry";
import {
  changePlanAction, reactivateCompanyAction, resetCompanyModuleAction, setCompanyLimitAction, setCompanyModuleAction,
  suspendCompanyAction, updateCompanyAction,
} from "@/modules/platform/actions";
import { platformUpdateCompanySchema } from "@/modules/platform/schemas";
import { COUNTRIES, CURRENCIES, formatMoney } from "@/lib/reference-data";

interface Props {
  company: { id: string; legalName: string; tradeName: string; email: string; phone: string; country: string; currency: string; status: "ACTIVE" | "SUSPENDED"; suspendedReason: string | null; createdAt: string; slug: string };
  subscription: { planId: string; planName: string; status: string; billingCycle: "MONTHLY" | "YEARLY"; periodEnd: string; trialEnds: string | null; price: number; currency: string } | null;
  plans: { id: string; name: string }[];
  modules: { key: string; name: string; kind: string; enabled: boolean; source: "PLAN" | "OVERRIDE" }[];
  limits: { key: string; effective: number; used: number; overridden: boolean }[];
  members: { id: string; name: string; email: string; role: string; status: string; isOwner: boolean; lastLogin: string }[];
  invitations: { id: string; email: string; role: string; expires: string }[];
  activity: { id: string; summary: string; who: string; at: string }[];
}

const SUB_STATUS = [
  { v: "TRIALING", l: "Période d'essai" }, { v: "ACTIVE", l: "Actif" }, { v: "PAST_DUE", l: "Paiement en retard" }, { v: "CANCELED", l: "Résilié" },
];

export function CompanyAdminPanel(props: Props) {
  const { company, subscription, plans, modules, limits, members, invitations, activity } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reason, setReason] = useState("");

  const run = (p: Promise<Awaited<ReturnType<typeof reactivateCompanyAction>>>, success: string) =>
    start(async () => { const r = await runAction(p, { success }); if (r.ok) router.refresh(); });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={company.status === "ACTIVE" ? "secondary" : "destructive"}>{company.status === "ACTIVE" ? "Active" : "Suspendue"}</Badge>
        <span className="text-sm text-muted-foreground">Créée le {company.createdAt} · identifiant « {company.slug} »</span>
        <div className="ml-auto">
          {company.status === "ACTIVE" ? (
            <Button variant="outline" onClick={() => setSuspendOpen(true)}><PauseCircle className="size-4" /> Suspendre</Button>
          ) : (
            <Button disabled={pending} onClick={() => run(reactivateCompanyAction({ companyId: company.id }), "Entreprise réactivée")}><PlayCircle className="size-4" /> Réactiver</Button>
          )}
        </div>
      </div>
      {company.status === "SUSPENDED" && company.suspendedReason && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">Motif de suspension : {company.suspendedReason}</p>
      )}

      <Tabs defaultValue="apercu">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="apercu">Aperçu</TabsTrigger>
          <TabsTrigger value="abonnement">Abonnement</TabsTrigger>
          <TabsTrigger value="modules">Modules</TabsTrigger>
          <TabsTrigger value="limites">Limites</TabsTrigger>
          <TabsTrigger value="utilisateurs">Utilisateurs ({members.length})</TabsTrigger>
          <TabsTrigger value="activite">Activité</TabsTrigger>
        </TabsList>

        <TabsContent value="apercu" className="mt-4"><IdentityForm company={company} /></TabsContent>

        <TabsContent value="abonnement" className="mt-4">
          <SubscriptionCard companyId={company.id} subscription={subscription} plans={plans} onDone={() => router.refresh()} />
        </TabsContent>

        <TabsContent value="modules" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Modules</CardTitle><CardDescription>Par défaut, les modules suivent l'offre. Une activation/désactivation manuelle devient une surcharge, conservée lors des changements d'offre.</CardDescription></CardHeader>
            <CardContent className="divide-y p-0">
              {modules.map((m) => (
                <div key={m.key} className="flex items-center gap-3 px-6 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{m.name} {m.kind === "EXTENSION" && <Badge variant="outline" className="ml-1">Extension</Badge>}</p>
                    <p className="text-xs text-muted-foreground">{m.kind === "CORE" ? "Toujours actif" : m.source === "OVERRIDE" ? "Surcharge manuelle" : "Selon l'offre"}</p>
                  </div>
                  {m.source === "OVERRIDE" && m.kind !== "CORE" && (
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(resetCompanyModuleAction({ companyId: company.id, moduleKey: m.key }), "Module rétabli selon l'offre")}><RotateCcw className="size-3.5" /> Selon l'offre</Button>
                  )}
                  <Switch checked={m.enabled} disabled={pending || m.kind === "CORE"} onCheckedChange={(v) => run(setCompanyModuleAction({ companyId: company.id, moduleKey: m.key, enabled: v }), v ? "Module activé" : "Module désactivé")} aria-label={`Module ${m.name}`} />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="limites" className="mt-4">
          <LimitsCard companyId={company.id} limits={limits} onDone={() => router.refresh()} />
        </TabsContent>

        <TabsContent value="utilisateurs" className="mt-4 space-y-4">
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Membre</TableHead><TableHead>Rôle</TableHead><TableHead className="hidden sm:table-cell">Dernière connexion</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell><p className="text-sm font-medium">{m.name}{m.isOwner && <Badge variant="secondary" className="ml-2">Propriétaire</Badge>}</p><p className="text-xs text-muted-foreground">{m.email}</p></TableCell>
                    <TableCell className="text-sm">{m.role}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{m.lastLogin}</TableCell>
                    <TableCell><Badge variant={m.status === "ACTIVE" ? "secondary" : "destructive"}>{m.status === "ACTIVE" ? "Actif" : "Suspendu"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          {invitations.length > 0 && (
            <Card><CardHeader><CardTitle className="text-base">Invitations en attente</CardTitle></CardHeader>
              <CardContent className="divide-y p-0">{invitations.map((i) => <p key={i.id} className="px-6 py-2.5 text-sm">{i.email} <span className="text-muted-foreground">· {i.role} · expire le {i.expires}</span></p>)}</CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="activite" className="mt-4">
          <Card>
            <CardContent className="divide-y p-0">
              {activity.length === 0 && <p className="px-6 py-6 text-sm text-muted-foreground">Aucune activité enregistrée.</p>}
              {activity.map((a) => <div key={a.id} className="px-6 py-3"><p className="text-sm">{a.summary}</p><p className="text-xs text-muted-foreground">{a.who} · {a.at}</p></div>)}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Suspendre {company.tradeName || company.legalName} ?</DialogTitle><DialogDescription>Tous les membres perdent l'accès immédiatement. Les données sont conservées et l'entreprise peut être réactivée.</DialogDescription></DialogHeader>
          <Field label="Motif (optionnel)" htmlFor="reason"><Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} /></Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendOpen(false)}>Annuler</Button>
            <Button variant="destructive" disabled={pending} onClick={() => { setSuspendOpen(false); run(suspendCompanyAction({ companyId: company.id, reason: reason || undefined }), "Entreprise suspendue"); }}>Suspendre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type IdValues = z.input<typeof platformUpdateCompanySchema>;

function IdentityForm({ company }: { company: Props["company"] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, control, handleSubmit, setError, formState: { errors } } = useForm<IdValues>({
    resolver: zodResolver(platformUpdateCompanySchema),
    defaultValues: { companyId: company.id, legalName: company.legalName, tradeName: company.tradeName, email: company.email, phone: company.phone, country: company.country, currency: company.currency },
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Informations</CardTitle></CardHeader>
      <CardContent>
        <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => start(async () => {
          setFormError(null);
          const res = await updateCompanyAction(v);
          if (!res.ok) return setFormError(applyServerErrors(res.error, setError));
          toast.success("Entreprise mise à jour"); router.refresh();
        }))}>
          <div className="sm:col-span-2"><FormAlert message={formError} /></div>
          <Field label="Raison sociale" htmlFor="p-legal" error={errors.legalName?.message}><Input id="p-legal" {...register("legalName")} /></Field>
          <Field label="Nom commercial" htmlFor="p-trade" error={errors.tradeName?.message}><Input id="p-trade" {...register("tradeName")} /></Field>
          <Field label="E-mail" htmlFor="p-email" error={errors.email?.message}><Input id="p-email" type="email" {...register("email")} /></Field>
          <Field label="Téléphone" htmlFor="p-phone" error={errors.phone?.message}><Input id="p-phone" {...register("phone")} /></Field>
          <Field label="Pays" error={errors.country?.message}>
            <Controller control={control} name="country" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}</SelectContent></Select>
            )} />
          </Field>
          <Field label="Devise" error={errors.currency?.message}>
            <Controller control={control} name="currency" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>)}</SelectContent></Select>
            )} />
          </Field>
          <div className="sm:col-span-2"><SubmitButton pending={pending}>Enregistrer</SubmitButton></div>
        </form>
      </CardContent>
    </Card>
  );
}

function SubscriptionCard({ companyId, subscription, plans, onDone }: { companyId: string; subscription: Props["subscription"]; plans: Props["plans"]; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [planId, setPlanId] = useState(subscription?.planId ?? "");
  const [status, setStatus] = useState(subscription?.status ?? "ACTIVE");
  const [cycle, setCycle] = useState<"MONTHLY" | "YEARLY">(subscription?.billingCycle ?? "MONTHLY");
  if (!subscription) return <Card><CardContent className="py-6 text-sm text-muted-foreground">Aucun abonnement.</CardContent></Card>;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Abonnement — {subscription.planName}</CardTitle>
        <CardDescription>{formatMoney(subscription.price, subscription.currency)} / {subscription.billingCycle === "MONTHLY" ? "mois" : "an"} · période jusqu'au {subscription.periodEnd}{subscription.trialEnds ? ` · essai jusqu'au ${subscription.trialEnds}` : ""}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <Field label="Offre"><Select value={planId} onValueChange={setPlanId}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Statut"><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{SUB_STATUS.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Facturation"><Select value={cycle} onValueChange={(v) => setCycle(v as "MONTHLY" | "YEARLY")}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="MONTHLY">Mensuelle</SelectItem><SelectItem value="YEARLY">Annuelle</SelectItem></SelectContent></Select></Field>
        <div className="sm:col-span-3">
          <Button disabled={pending} onClick={() => start(async () => {
            const r = await runAction(changePlanAction({ companyId, planId, status: status as "ACTIVE", billingCycle: cycle }), { success: "Abonnement mis à jour (modules synchronisés)" });
            if (r.ok) onDone();
          })}>Appliquer</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LimitsCard({ companyId, limits, onDone }: { companyId: string; limits: Props["limits"]; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const label = (k: string) => LIMIT_KEYS.find((l) => l.key === k)?.label ?? k;
  const save = (key: string, value: number | null) =>
    start(async () => { const r = await runAction(setCompanyLimitAction({ companyId, key, value }), { success: "Limite mise à jour" }); if (r.ok) { setDrafts((d) => { const n = { ...d }; delete n[key]; return n; }); onDone(); } });

  return (
    <Card className="overflow-hidden p-0">
      <Table>
        <TableHeader><TableRow><TableHead>Limite</TableHead><TableHead>Utilisé</TableHead><TableHead>Effective</TableHead><TableHead>Surcharge (-1 = illimité)</TableHead></TableRow></TableHeader>
        <TableBody>
          {limits.map((l) => (
            <TableRow key={l.key}>
              <TableCell className="text-sm font-medium">{label(l.key)}</TableCell>
              <TableCell className="tabular text-sm">{l.used}</TableCell>
              <TableCell className="text-sm">{l.effective === UNLIMITED ? "Illimité" : l.effective} {l.overridden && <Badge variant="outline" className="ml-1">Surchargée</Badge>}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Input type="number" min={-1} className="h-8 w-28" aria-label={`Surcharge ${label(l.key)}`} value={drafts[l.key] ?? ""} placeholder={l.overridden ? String(l.effective) : "—"} onChange={(e) => setDrafts((d) => ({ ...d, [l.key]: e.target.value }))} />
                  <Button size="sm" variant="outline" disabled={pending || drafts[l.key] === undefined || drafts[l.key] === ""} onClick={() => save(l.key, Number(drafts[l.key]))}>Définir</Button>
                  {l.overridden && <Button size="sm" variant="ghost" disabled={pending} onClick={() => save(l.key, null)}>Retirer</Button>}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
