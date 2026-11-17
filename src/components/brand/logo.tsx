import Image from "next/image";
import { cn } from "@/lib/utils";

/** Marque : le « G » du logo Global Gest (fichier généré par scripts/make-brand-assets.mjs, fond transparent). */
export function LogoMark({ className }: { className?: string }) {
  return <Image src="/brand/global-gest-mark.png" alt="" width={512} height={512} sizes="80px" className={cn("size-10 object-contain", className)} aria-hidden="true" />;
}

const WORDMARK = "url(/brand/global-gest-wordmark.png)";

/**
 * Nom « Global Gest », avec la typographie exacte du logo. Le fichier (blanc, fond transparent) sert de MASQUE : le texte prend la
 * couleur courante (`currentColor`), donc blanc sur fond marine et marine sur fond clair, sans second fichier.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Global Gest"
      className={cn("block aspect-[821/124] h-[1.4rem] bg-current", className)}
      style={{
        WebkitMaskImage: WORDMARK, maskImage: WORDMARK, WebkitMaskSize: "contain", maskSize: "contain",
        WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskPosition: "left center", maskPosition: "left center",
      }}
    />
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 [&_img]:transition-transform [&_img]:duration-500 hover:[&_img]:-rotate-[8deg] hover:[&_img]:scale-110", className)}>
      <LogoMark />
      {!compact && <Wordmark />}
    </span>
  );
}
