"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { SubmitButton, runAction } from "@/components/app/form-kit";
import { saveNotificationPrefsAction } from "@/modules/settings/actions";

interface Pref { type: string; label: string; note?: string; inApp: boolean; email: boolean }

export function NotificationPrefsForm({ initial }: { initial: Pref[] }) {
  const [prefs, setPrefs] = useState(initial);
  const [pending, start] = useTransition();
  const set = (type: string, patch: Partial<Pick<Pref, "inApp" | "email">>) =>
    setPrefs((p) => p.map((x) => (x.type === type ? { ...x, ...patch } : x)));

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-muted-foreground">Choisissez comment être prévenu pour chaque type d'événement dans cette entreprise. Les e-mails sont envoyés par la tâche planifiée de l'application (pas instantanément).</p>
      <Card className="divide-y p-0">
        <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 px-4 py-2.5 text-xs font-medium text-muted-foreground">
          <span>Événement</span><span className="text-center">Dans l'app</span><span className="text-center">E-mail</span>
        </div>
        {prefs.map((p) => (
          <div key={p.type} className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 px-4 py-3">
            <span className="text-sm">{p.label}{p.note && <span className="ml-2 text-xs text-muted-foreground">({p.note})</span>}</span>
            <span className="flex justify-center"><Switch checked={p.inApp} onCheckedChange={(v) => set(p.type, { inApp: v })} aria-label={`${p.label} — dans l'application`} /></span>
            <span className="flex justify-center"><Switch checked={p.email} onCheckedChange={(v) => set(p.type, { email: v })} aria-label={`${p.label} — par e-mail`} /></span>
          </div>
        ))}
      </Card>
      <form onSubmit={(e) => { e.preventDefault(); start(async () => { await runAction(saveNotificationPrefsAction({ prefs: prefs.map(({ type, inApp, email }) => ({ type, inApp, email })) }), { success: "Préférences enregistrées" }); }); }}>
        <SubmitButton pending={pending}>Enregistrer</SubmitButton>
      </form>
    </div>
  );
}
