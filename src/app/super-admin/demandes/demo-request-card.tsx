"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { runAction } from "@/components/app/form-kit";
import { updateDemoRequestAction } from "@/modules/platform/actions";
import { DEMO_STATUSES } from "@/modules/platform/schemas";

type Status = (typeof DEMO_STATUSES)[number]["value"];
interface Req { id: string; fullName: string; email: string; phone: string; companyName: string; country: string; sector: string; companySize: string; message: string; status: Status; notes: string; createdAt: string }

export function DemoRequestCard({ request: r }: { request: Req }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<Status>(r.status);
  const [notes, setNotes] = useState(r.notes);
  const dirty = status !== r.status || notes !== r.notes;

  return (
    <Card className="gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{r.fullName} <span className="font-normal text-muted-foreground">— {r.companyName}</span></p>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 hover:text-foreground"><Mail className="size-3.5" />{r.email}</a>
            {r.phone && <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 hover:text-foreground"><Phone className="size-3.5" />{r.phone}</a>}
            <span>{[r.country, r.sector, r.companySize && `${r.companySize} employés`].filter(Boolean).join(" · ")}</span>
          </p>
        </div>
        <span className="text-xs text-muted-foreground">{r.createdAt}</span>
      </div>
      {r.message && <p className="rounded-md bg-muted/60 p-3 text-sm">{r.message}</p>}
      <div className="grid gap-3 sm:grid-cols-[14rem_1fr_auto] sm:items-start">
        <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
          <SelectTrigger className="w-full" aria-label="Statut"><SelectValue /></SelectTrigger>
          <SelectContent>{DEMO_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
        <Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes internes…" aria-label="Notes internes" />
        <Button disabled={pending || !dirty} onClick={() => start(async () => { const x = await runAction(updateDemoRequestAction({ id: r.id, status, notes }), { success: "Demande mise à jour" }); if (x.ok) router.refresh(); })}>Enregistrer</Button>
      </div>
    </Card>
  );
}
