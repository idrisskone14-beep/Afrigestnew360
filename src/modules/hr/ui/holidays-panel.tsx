"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarPlus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormAlert } from "@/components/app/form-kit";
import { addHolidayAction, deleteHolidayAction, generateHolidaysAction, setWorkDaysAction } from "../actions";

type Fail = { message: string; fieldErrors?: Record<string, string[]> };
const errText = (e: Fail) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);
const WEEK = [{ d: 1, l: "Lun" }, { d: 2, l: "Mar" }, { d: 3, l: "Mer" }, { d: 4, l: "Jeu" }, { d: 5, l: "Ven" }, { d: 6, l: "Sam" }, { d: 0, l: "Dim" }];

export interface HolidayRow { id: string; date: string; label: string; name: string }

/** Jours fériés de l'année (ajout, suppression, génération par pays) et semaine travaillée de l'entreprise. */
export function HolidaysPanel({ year, rows, workDays, countries, defaultCountry, canManage }: {
  year: number; rows: HolidayRow[]; workDays: number[]; countries: { code: string; label: string }[]; defaultCountry: string; canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [country, setCountry] = useState(defaultCountry);
  const [week, setWeek] = useState(new Set(workDays));

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: Fail }>, ok: string) => start(async () => {
    setError(null);
    const res = await fn();
    if (!res.ok) return setError(errText(res.error));
    toast.success(ok);
    router.refresh();
  });

  return (
    <div className="space-y-6">
      <FormAlert message={error} />
      <Card className="space-y-3 p-5">
        <div><h2 className="text-base font-semibold">Semaine travaillée</h2><p className="text-sm text-muted-foreground">Seuls ces jours comptent dans un congé et dans le prorata de la paie (jours fériés ci-dessous exclus).</p></div>
        <div className="flex flex-wrap items-center gap-2">
          {WEEK.map((w) => (
            <label key={w.d} className={`flex min-h-10 min-w-14 cursor-pointer items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors ${week.has(w.d) ? "border-brand bg-accent text-accent-foreground" : "bg-card text-muted-foreground"} ${canManage ? "" : "pointer-events-none opacity-70"}`}>
              <input type="checkbox" className="sr-only" checked={week.has(w.d)} disabled={!canManage} onChange={(e) => setWeek((s) => { const n = new Set(s); if (e.target.checked) n.add(w.d); else n.delete(w.d); return n; })} />{w.l}
            </label>
          ))}
          {canManage && <Button variant="outline" disabled={pending || week.size === 0} onClick={() => run(async () => { const r = await setWorkDaysAction({ workDays: [...week] }); return r.ok ? { ok: true } : r; }, "Semaine travaillée enregistrée")}>Enregistrer</Button>}
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="text-base font-semibold">Jours fériés {year}</h2><p className="text-sm text-muted-foreground">{rows.length} jour{rows.length > 1 ? "s" : ""} férié{rows.length > 1 ? "s" : ""}.</p></div>
          {canManage && (
            <div className="flex flex-wrap items-end gap-2">
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger className="w-64 max-w-full" aria-label="Pays"><SelectValue /></SelectTrigger>
                <SelectContent>{countries.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="outline" disabled={pending} onClick={() => start(async () => {
                setError(null);
                const res = await generateHolidaysAction({ country, year });
                if (!res.ok) return setError(errText(res.error));
                toast.success(`${res.data.added} jour(s) ajouté(s)${res.data.skipped ? `, ${res.data.skipped} déjà présent(s)` : ""}`);
                router.refresh();
              })}><Sparkles className="size-4" /> Générer les fêtes fixes</Button>
            </div>
          )}
        </div>
        <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">La génération couvre les dates fixes et les fêtes liées à Pâques (Lundi de Pâques, Ascension, Pentecôte). Les fêtes musulmanes (Aïd el-Fitr, Tabaski, Mouloud…) dépendent de l&apos;observation de la lune et d&apos;un décret : ajoutez-les chaque année quand elles sont annoncées. Vérifiez la liste avant de l&apos;adopter : les dates officielles peuvent changer par décret.</p>

        {rows.length === 0 ? <p className="text-sm text-muted-foreground">Aucun jour férié enregistré pour {year}.</p> : (
          <ul className="divide-y rounded-lg border">
            {rows.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-44 shrink-0 text-muted-foreground tabular">{h.label}</span>
                <span className="min-w-0 flex-1 font-medium">{h.name}</span>
                {canManage && <Button variant="ghost" size="icon" aria-label={`Supprimer ${h.name}`} disabled={pending} onClick={() => run(async () => { const r = await deleteHolidayAction({ id: h.id }); return r.ok ? { ok: true } : r; }, "Jour férié supprimé")}><Trash2 className="size-4" /></Button>}
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Date" htmlFor="hd-date"><Input id="hd-date" type="date" value={date} min={`${year}-01-01`} max={`${year}-12-31`} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Nom" htmlFor="hd-name" className="min-w-48 flex-1"><Input id="hd-name" value={name} placeholder="Ex. Tabaski (Aïd el-Kébir)" onChange={(e) => setName(e.target.value)} /></Field>
            <Button disabled={pending || !date || name.trim().length < 2} onClick={() => run(async () => { const r = await addHolidayAction({ date, name }); if (r.ok) { setDate(""); setName(""); return { ok: true }; } return r; }, "Jour férié ajouté")}><CalendarPlus className="size-4" /> Ajouter</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
