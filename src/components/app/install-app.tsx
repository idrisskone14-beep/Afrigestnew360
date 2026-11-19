"use client";

import { useEffect, useState } from "react";
import { Download, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isStandalone, useInstallPrompt } from "./pwa-register";

const DISMISS_KEY = "gg_install_banner_dismissed";

/** Environnement de l'appareil, lu après l'affichage (jamais au rendu serveur : pas d'écart d'hydratation). */
export function useAppEnvironment() {
  const [env, setEnv] = useState({ ready: false, standalone: false, ios: false, android: false });
  useEffect(() => {
    const ua = navigator.userAgent;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture unique du navigateur au montage
    setEnv({ ready: true, standalone: isStandalone(), ios: /iphone|ipad|ipod/i.test(ua), android: /android/i.test(ua) });
  }, []);
  return env;
}

/** Marche à suivre quand le navigateur ne propose pas l'installation d'un seul geste (iPhone, Safari, Firefox…). */
export function InstallGuideDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const env = useAppEnvironment();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Smartphone className="size-5 text-brand" aria-hidden="true" /> Installer Global Gest</DialogTitle>
          <DialogDescription>Plein écran, ouverture en un geste depuis votre écran d&apos;accueil, sans passer par un magasin d&apos;applications.</DialogDescription>
        </DialogHeader>
        {env.ios ? (
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Ouvrez ce site dans <strong>Safari</strong> (l&apos;installation ne marche pas depuis les autres navigateurs de l&apos;iPhone).</li>
            <li>Touchez le bouton <strong>Partager</strong> (le carré avec une flèche vers le haut).</li>
            <li>Choisissez <strong>« Sur l&apos;écran d&apos;accueil »</strong>, puis <strong>Ajouter</strong>.</li>
            <li>Ouvrez ensuite Global Gest depuis son icône.</li>
          </ol>
        ) : env.android ? (
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Ouvrez le menu du navigateur (les <strong>trois points</strong> en haut à droite).</li>
            <li>Touchez <strong>« Installer l&apos;application »</strong> ou <strong>« Ajouter à l&apos;écran d&apos;accueil »</strong>.</li>
            <li>Confirmez. L&apos;icône apparaît sur votre écran d&apos;accueil.</li>
          </ol>
        ) : (
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Sur <strong>Chrome</strong> ou <strong>Edge</strong> : cliquez sur l&apos;icône d&apos;installation à droite de la barre d&apos;adresse, ou ouvrez le menu (les trois points) puis <strong>« Installer Global Gest »</strong>.</li>
            <li>Sur <strong>Safari (Mac)</strong> : menu <strong>Fichier</strong> puis <strong>« Ajouter au Dock »</strong>.</li>
            <li>Firefox sur ordinateur ne permet pas l&apos;installation : utilisez Chrome ou Edge.</li>
          </ol>
        )}
        <Button onClick={() => onOpenChange(false)}>Compris</Button>
      </DialogContent>
    </Dialog>
  );
}

/** Lance l'installation d'un geste quand le navigateur le permet, sinon ouvre la marche à suivre. */
export function useInstallAction() {
  const { canInstall, install } = useInstallPrompt();
  const [guide, setGuide] = useState(false);
  return { canInstall, run: () => (canInstall ? void install() : setGuide(true)), guide, setGuide };
}

/** Bouton de l'en-tête : visible dès que l'installation est possible (ou, sur iPhone, expliquée). */
export function InstallTopbarButton() {
  const env = useAppEnvironment();
  const { canInstall, run, guide, setGuide } = useInstallAction();
  if (!env.ready || env.standalone || !(canInstall || env.ios)) return null;
  return (
    <>
      <Button variant="outline" size="sm" className="hidden gap-1.5 sm:inline-flex" onClick={run}>
        <Download className="size-4" aria-hidden="true" /> Installer l&apos;app
      </Button>
      <InstallGuideDialog open={guide} onOpenChange={setGuide} />
    </>
  );
}

/** Bandeau du tableau de bord (surtout utile sur téléphone), fermable une fois pour toutes. */
export function InstallBanner() {
  const env = useAppEnvironment();
  const { canInstall, run, guide, setGuide } = useInstallAction();
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture unique du stockage local au montage
    try { setHidden(localStorage.getItem(DISMISS_KEY) === "1"); } catch { setHidden(false); }
  }, []);
  if (!env.ready || env.standalone || hidden || !(canInstall || env.ios || env.android)) return null;
  const dismiss = () => { setHidden(true); try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* sans stockage : le bandeau réapparaîtra */ } };
  return (
    <>
      <div role="region" aria-label="Installer l'application" className="mb-5 flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3">
        <Smartphone className="size-5 shrink-0 text-brand" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm"><span className="font-medium">Installez Global Gest</span><span className="hidden sm:inline"> sur votre écran d&apos;accueil : plein écran, ouverture en un geste.</span></p>
        <Button size="sm" onClick={run}><Download className="size-4" aria-hidden="true" /> Installer</Button>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Masquer ce message" onClick={dismiss}><X className="size-4" /></Button>
      </div>
      <InstallGuideDialog open={guide} onOpenChange={setGuide} />
    </>
  );
}
