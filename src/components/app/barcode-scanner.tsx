"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Keyboard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Phase = "starting" | "scanning" | "denied" | "unsupported";

interface DetectorLike { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
type DetectorCtor = (new (opts?: { formats?: string[] }) => DetectorLike) & { getSupportedFormats?: () => Promise<string[]> };

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar", "qr_code", "data_matrix"];

/**
 * Scanner de code-barres par la caméra de l'appareil. Utilise le détecteur natif du navigateur quand il existe (Chrome, Android),
 * sinon la bibliothèque ZXing chargée à la demande (Safari, iPhone). Si la caméra est refusée ou absente, le code peut être saisi à la main.
 * La caméra n'est active que pendant que la fenêtre est ouverte ; le flux est coupé à la fermeture.
 */
export function BarcodeScannerDialog({ open, onOpenChange, onDetected, title = "Scanner un code-barres", description = "Cadrez le code-barres dans le rectangle." }: {
  open: boolean; onOpenChange: (open: boolean) => void; onDetected: (code: string) => void; title?: string; description?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [manual, setManual] = useState("");
  const done = useRef(false);

  useEffect(() => {
    if (!open) return;
    done.current = false;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopZxing: (() => void) | null = null;
    let cancelled = false;
    let el: HTMLVideoElement | null = null;

    const finish = (code: string) => {
      if (done.current || cancelled) return;
      done.current = true;
      if (navigator.vibrate) navigator.vibrate(60);
      onDetected(code.trim());
    };

    (async () => {
      setPhase("starting");
      if (!navigator.mediaDevices?.getUserMedia) return setPhase("unsupported");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
      } catch {
        return setPhase("denied");
      }
      if (cancelled || !video.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      el = video.current;
      el.srcObject = stream;
      await el.play().catch(() => undefined);
      setPhase("scanning");

      const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      if (Native) {
        const supported = (await Native.getSupportedFormats?.().catch(() => FORMATS)) ?? FORMATS;
        const detector = new Native({ formats: FORMATS.filter((f) => supported.includes(f)) });
        let last = 0;
        const tick = async (now: number) => {
          if (cancelled || done.current) return;
          if (now - last > 180 && video.current && video.current.readyState >= 2) {
            last = now;
            try { const found = await detector.detect(video.current); if (found[0]?.rawValue) return finish(found[0].rawValue); } catch { /* image non exploitable : on réessaie */ }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return;
      }

      // repli : ZXing (chargé seulement ici)
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      if (cancelled || !video.current) return;
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromVideoElement(video.current, (result) => { if (result) finish(result.getText()); });
      stopZxing = () => controls.stop();
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stopZxing?.();
      stream?.getTracks().forEach((t) => t.stop());
      if (el) el.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDetected est volontairement lu à la détection, pas à l'ouverture
  }, [open]);

  const submitManual = () => { const c = manual.trim(); if (c) { done.current = true; onDetected(c); setManual(""); } };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
          <video ref={video} playsInline muted autoPlay className="size-full object-cover" aria-label="Aperçu de la caméra" />
          {phase === "scanning" && <div aria-hidden="true" className="pointer-events-none absolute inset-x-[12%] inset-y-[28%] rounded-lg border-2 border-brand-2 shadow-[0_0_0_9999px_rgb(0_0_0/0.45)]" />}
          {phase === "starting" && <div className="absolute inset-0 grid place-items-center text-white"><Loader2 className="size-6 animate-spin" aria-label="Démarrage de la caméra" /></div>}
          {(phase === "denied" || phase === "unsupported") && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white">
              <div><Camera className="mx-auto mb-2 size-7 opacity-80" />{phase === "denied" ? "L'accès à la caméra est refusé. Autorisez-le dans les réglages du navigateur, ou saisissez le code ci-dessous." : "La caméra n'est pas disponible sur cet appareil. Saisissez le code ci-dessous."}</div>
            </div>
          )}
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); submitManual(); }}>
          <div className="relative flex-1">
            <Keyboard className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" />
            <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Ou saisissez le code" inputMode="text" className="h-10 pl-9" aria-label="Code saisi à la main" />
          </div>
          <Button type="submit" disabled={!manual.trim()} className="h-10">Valider</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
