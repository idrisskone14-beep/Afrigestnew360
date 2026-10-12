"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing, Download, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isStandalone, useInstallPrompt } from "@/components/app/pwa-register";
import { removePushSubscriptionAction, savePushSubscriptionAction, sendTestPushAction } from "@/modules/settings/actions";

type State = "loading" | "unsupported" | "unconfigured" | "blocked" | "off" | "on";

/** Clé publique VAPID (base64url) → octets, format attendu par `pushManager.subscribe`. */
function keyToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const isIos = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

/** Notifications push de CET appareil : activer, désactiver, tester ; et installer l'application sur l'écran d'accueil. */
export function PushCard({ publicKey, devices }: { publicKey: string | null; devices: number }) {
  const [state, setState] = useState<State>("loading");
  const [pending, start] = useTransition();
  const install = useInstallPrompt();
  const [needsInstall, setNeedsInstall] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      // iPhone : le push n'existe que dans l'application installée sur l'écran d'accueil
      if (!supported) { if (alive) { setNeedsInstall(isIos() && !isStandalone()); setState("unsupported"); } return; }
      if (!publicKey) { if (alive) setState("unconfigured"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (alive) setState(sub ? "on" : Notification.permission === "denied" ? "blocked" : "off");
    })().catch(() => alive && setState("unsupported"));
    return () => { alive = false; };
  }, [publicKey]);

  const enable = () => start(async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "blocked" : "off"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey!) });
      const json = sub.toJSON();
      const res = await savePushSubscriptionAction({ endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" }, userAgent: navigator.userAgent });
      if (!res.ok) { await sub.unsubscribe(); toast.error(res.error.message); return; }
      setState("on");
      toast.success("Notifications activées sur cet appareil");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Activation impossible");
    }
  });

  const disable = () => start(async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await removePushSubscriptionAction({ endpoint: sub.endpoint }); await sub.unsubscribe(); }
    setState("off");
    toast.success("Notifications désactivées sur cet appareil");
  });

  const test = () => start(async () => {
    const res = await sendTestPushAction({});
    if (!res.ok) return void toast.error(res.error.message);
    if (res.data.sent > 0) toast.success("Notification envoyée : elle arrive dans quelques secondes");
    else toast.warning("Aucun appareil n'a reçu la notification : réactivez-la sur cet appareil.");
  });

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-brand"><BellRing className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-base font-semibold">Notifications sur cet appareil</h2>
          <p className="text-sm text-muted-foreground">
            {state === "on" && "Vous recevez les alertes (validations, paiements, échéances, réponses de clients…) même quand l'application est fermée."}
            {state === "off" && "Recevez les alertes importantes directement sur cet appareil, même application fermée."}
            {state === "blocked" && "Les notifications sont bloquées pour ce site. Autorisez-les dans les réglages du navigateur (icône de cadenas à côté de l'adresse), puis revenez ici."}
            {state === "unconfigured" && "Les notifications push ne sont pas encore activées par l'administrateur de la plateforme."}
            {state === "unsupported" && (needsInstall ? "Sur iPhone, installez d'abord l'application : bouton Partager, puis « Sur l'écran d'accueil ». Ouvrez-la ensuite depuis l'icône pour activer les notifications." : "Ce navigateur ne gère pas les notifications push.")}
            {state === "loading" && "Vérification…"}
            {devices > 0 && state !== "loading" && <span className="block pt-1 text-xs">{devices} appareil{devices > 1 ? "s" : ""} inscrit{devices > 1 ? "s" : ""} sur votre compte.</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {state === "off" && <Button onClick={enable} disabled={pending}>Activer</Button>}
          {state === "on" && (<><Button variant="outline" onClick={test} disabled={pending}>Envoyer un test</Button><Button variant="ghost" onClick={disable} disabled={pending}>Désactiver</Button></>)}
        </div>
      </div>
      {install.canInstall && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3">
          <span className="flex items-center gap-2 text-sm"><Smartphone className="size-4 text-brand" aria-hidden="true" /> Installez AfriGest 360 sur l&apos;écran d&apos;accueil : plein écran, ouverture en un geste.</span>
          <Button variant="outline" size="sm" onClick={() => void install.install()}><Download className="size-4" /> Installer</Button>
        </div>
      )}
    </Card>
  );
}
