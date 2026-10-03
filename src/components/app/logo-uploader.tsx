"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LOGO_ACCEPT, LOGO_MAX_BYTES_CLIENT } from "@/lib/logo-constants";

/**
 * Sélecteur de logo avec aperçu. `value` = fichier choisi (onboarding : envoyé après la création)
 * ou `currentUrl` = logo existant. Le serveur revérifie le type réel et la taille.
 */
export function LogoPicker({ value, onChange, currentUrl, disabled }: {
  value: File | null; onChange: (f: File | null) => void; currentUrl?: string | null; disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const pick = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!LOGO_ACCEPT.split(",").includes(file.type)) return setError("Format non supporté : PNG, JPEG ou WebP.");
    if (file.size > LOGO_MAX_BYTES_CLIENT) return setError("Le logo ne doit pas dépasser 1 Mo.");
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    onChange(file);
  };

  const shown = preview ?? currentUrl ?? null;
  return (
    <div className="flex items-center gap-4">
      <div className="flex size-24 items-center justify-center overflow-hidden rounded-xl border bg-muted/40">
        {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob:) ou route protégée */}
        {shown ? <img src={shown} alt="Logo de l'entreprise" className="size-full object-contain" /> : <ImagePlus className="size-7 text-muted-foreground" />}
      </div>
      <div className="space-y-2">
        <input ref={input} type="file" accept={LOGO_ACCEPT} className="sr-only" aria-label="Choisir un logo" disabled={disabled} onChange={(e) => pick(e.target.files?.[0])} />
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => input.current?.click()}>{shown ? "Changer" : "Choisir une image"}</Button>
          {value && <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(null); if (preview) URL.revokeObjectURL(preview); setPreview(null); if (input.current) input.current.value = ""; }}><X className="size-4" /> Retirer</Button>}
        </div>
        <p className="text-xs text-muted-foreground">PNG, JPEG ou WebP — 1 Mo max. Affiché sur vos documents.</p>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
