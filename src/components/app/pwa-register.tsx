"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }

/** Enregistre le service worker (hors connexion + notifications push). Sans effet visuel. */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => console.warn("[pwa] service worker non enregistré", e));
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}

interface InstallState { canInstall: boolean; install: () => Promise<void> }
const InstallContext = createContext<InstallState>({ canInstall: false, install: async () => undefined });

/**
 * Capte UNE fois l'invite d'installation du navigateur (l'événement n'est émis qu'une fois) et la partage à tout l'écran :
 * bouton de l'en-tête, menu du compte, bandeau du tableau de bord, page Notifications.
 */
export function InstallProvider({ children }: { children: ReactNode }) {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setEvent(e as InstallEvent); };
    const onInstalled = () => { setInstalled(true); setEvent(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  const value = useMemo<InstallState>(() => ({
    canInstall: event !== null && !installed,
    install: async () => { if (!event) return; await event.prompt(); await event.userChoice; setEvent(null); },
  }), [event, installed]);
  return <InstallContext.Provider value={value}>{children}</InstallContext.Provider>;
}

/** Invite d'installation : `canInstall` devient vrai quand le navigateur propose d'installer l'application. */
export function useInstallPrompt(): InstallState {
  return useContext(InstallContext);
}

/** L'application tourne-t-elle déjà installée (plein écran) ? */
export function isStandalone(): boolean {
  return typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
}
