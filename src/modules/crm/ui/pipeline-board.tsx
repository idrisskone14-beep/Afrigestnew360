"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarDays, GripVertical, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert, runAction } from "@/components/app/form-kit";
import { formatMoney } from "@/lib/reference-data";
import { cn } from "@/lib/utils";
import { createOpportunityAction, deleteOpportunityAction, moveOpportunityAction, updateOpportunityAction } from "../actions";

export interface StageVM { id: string; name: string; kind: "OPEN" | "WON" | "LOST"; probability: number }
export interface OppVM { id: string; title: string; stageId: string; amount: number; customerId: string | null; customerName: string | null; expectedCloseDate: string | null; notes: string | null; lostReason: string | null }

const NONE = "none";

export function PipelineBoard({ stages, opps, customers, currency, can }: {
  stages: StageVM[]; opps: OppVM[]; customers: { id: string; name: string }[]; currency: string; can: { create: boolean; update: boolean; delete: boolean };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [lostFor, setLostFor] = useState<{ opp: OppVM; stageId: string } | null>(null);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState<OppVM | "new" | null>(null);

  const move = (opp: OppVM, stageId: string, lostReason?: string) => {
    if (opp.stageId === stageId) return;
    const stage = stages.find((s) => s.id === stageId)!;
    if (stage.kind === "LOST" && !lostReason) { setLostFor({ opp, stageId }); setReason(""); return; }
    start(async () => {
      const r = await runAction(moveOpportunityAction({ id: opp.id, stageId, lostReason }), { silentError: false });
      if (r.ok) { toast.success(`« ${opp.title} » → ${stage.name}`); router.refresh(); }
    });
  };

  return (
    <div>
      {can.create && <div className="mb-4 flex justify-end"><Button onClick={() => setEditing("new")}><Plus className="size-4" /> Nouvelle opportunité</Button></div>}
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0" aria-busy={pending}>
        {stages.map((s) => {
          const list = opps.filter((o) => o.stageId === s.id);
          const sum = list.reduce((a, o) => a + o.amount, 0);
          return (
            <section
              key={s.id}
              aria-label={`Étape ${s.name}`}
              onDragOver={(e) => { if (can.update) { e.preventDefault(); setOverStage(s.id); } }}
              onDragLeave={() => setOverStage((o) => (o === s.id ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOverStage(null); const opp = opps.find((o) => o.id === dragId); if (opp && can.update) move(opp, s.id); setDragId(null); }}
              className={cn("w-72 shrink-0 rounded-xl border bg-muted/40 p-3 transition-colors", overStage === s.id && "border-brand bg-accent/50")}
            >
              <header className="mb-3 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <span className={cn("size-2 rounded-full", s.kind === "WON" ? "bg-success" : s.kind === "LOST" ? "bg-destructive" : "bg-brand")} />{s.name}
                  <span className="text-xs font-normal text-muted-foreground">{list.length}</span>
                </h3>
                <span className="tabular text-xs text-muted-foreground">{formatMoney(sum, currency)}</span>
              </header>
              <ul className="space-y-2">
                {list.map((o) => (
                  <li
                    key={o.id}
                    draggable={can.update}
                    onDragStart={() => setDragId(o.id)}
                    onDragEnd={() => { setDragId(null); setOverStage(null); }}
                    className={cn("group rounded-lg border bg-card p-3 shadow-sm", can.update && "cursor-grab active:cursor-grabbing", dragId === o.id && "opacity-50")}
                  >
                    <div className="flex items-start gap-2">
                      {can.update && <GripVertical className="mt-0.5 size-4 shrink-0 text-muted-foreground/50" aria-hidden />}
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(o)}>
                        <span className="block truncate text-sm font-medium">{o.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{o.customerName ?? "Sans client"}</span>
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="tabular font-medium">{formatMoney(o.amount, currency)}</span>
                      {o.expectedCloseDate && <span className="inline-flex items-center gap-1 text-muted-foreground"><CalendarDays className="size-3" />{new Date(o.expectedCloseDate).toLocaleDateString("fr-FR")}</span>}
                    </div>
                    {o.lostReason && <p className="mt-1.5 text-xs text-destructive">Motif : {o.lostReason}</p>}
                    {can.update && (
                      <div className="mt-2">
                        <Select value={o.stageId} onValueChange={(v) => move(o, v)}>
                          <SelectTrigger className="h-7 w-full text-xs" aria-label={`Déplacer ${o.title}`}><SelectValue /></SelectTrigger>
                          <SelectContent>{stages.map((st) => <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    )}
                  </li>
                ))}
                {list.length === 0 && <li className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">Déposez une opportunité ici</li>}
              </ul>
            </section>
          );
        })}
      </div>

      <Dialog open={lostFor !== null} onOpenChange={(o) => !o && setLostFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Motif de la perte</DialogTitle><DialogDescription>Indiquez pourquoi « {lostFor?.opp.title} » est perdue (utile pour vos analyses).</DialogDescription></DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Prix, concurrent, projet abandonné…" autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostFor(null)}>Annuler</Button>
            <Button variant="destructive" disabled={reason.trim().length < 2 || pending} onClick={() => { const l = lostFor!; setLostFor(null); move(l.opp, l.stageId, reason.trim()); }}>Marquer comme perdue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editing && <OpportunityDialog opp={editing === "new" ? null : editing} stages={stages} customers={customers} canDelete={can.delete} canEdit={editing === "new" ? can.create : can.update} onClose={() => setEditing(null)} />}
    </div>
  );
}

function OpportunityDialog({ opp, stages, customers, canDelete, canEdit, onClose }: {
  opp: OppVM | null; stages: StageVM[]; customers: { id: string; name: string }[]; canDelete: boolean; canEdit: boolean; onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const firstOpen = stages.find((s) => s.kind === "OPEN") ?? stages[0]!;
  const [f, setF] = useState({
    title: opp?.title ?? "", customerId: opp?.customerId ?? NONE, stageId: opp?.stageId ?? firstOpen.id, amount: String(opp?.amount ?? ""),
    expectedCloseDate: opp?.expectedCloseDate ? opp.expectedCloseDate.slice(0, 10) : "", notes: opp?.notes ?? "",
  });

  const submit = () => start(async () => {
    setError(null);
    const payload = { title: f.title, customerId: f.customerId === NONE ? "" : f.customerId, stageId: f.stageId, amount: Number(f.amount || 0), expectedCloseDate: f.expectedCloseDate, notes: f.notes };
    const res = opp ? await updateOpportunityAction({ ...payload, id: opp.id }) : await createOpportunityAction(payload);
    if (!res.ok) return setError(res.error.fieldErrors ? Object.values(res.error.fieldErrors).flat()[0] ?? res.error.message : res.error.message);
    toast.success(opp ? "Opportunité mise à jour" : "Opportunité créée");
    onClose(); router.refresh();
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{opp ? "Opportunité" : "Nouvelle opportunité"}</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <FormAlert message={error} />
          <Field label="Titre *" htmlFor="op-title"><Input id="op-title" value={f.title} disabled={!canEdit} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client">
              <Select value={f.customerId} disabled={!canEdit} onValueChange={(v) => setF({ ...f, customerId: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>— Aucun —</SelectItem>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Étape">
              <Select value={f.stageId} disabled={!canEdit} onValueChange={(v) => setF({ ...f, stageId: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Montant" htmlFor="op-amount"><Input id="op-amount" type="number" min={0} value={f.amount} disabled={!canEdit} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label="Clôture prévue" htmlFor="op-date"><Input id="op-date" type="date" value={f.expectedCloseDate} disabled={!canEdit} onChange={(e) => setF({ ...f, expectedCloseDate: e.target.value })} /></Field>
          </div>
          <Field label="Notes" htmlFor="op-notes"><Textarea id="op-notes" rows={3} value={f.notes} disabled={!canEdit} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <DialogFooter className="sm:justify-between">
          {opp && canDelete ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={pending} onClick={() => start(async () => { const r = await runAction(deleteOpportunityAction({ id: opp.id }), { success: "Opportunité supprimée" }); if (r.ok) { onClose(); router.refresh(); } })}><Trash2 className="size-4" /> Supprimer</Button>
          ) : <span />}
          {canEdit && <Button disabled={pending || f.title.trim().length < 2} onClick={submit}>Enregistrer</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
