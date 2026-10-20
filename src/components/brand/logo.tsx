import Image from "next/image";
import { cn } from "@/lib/utils";

/** Marque : le « K » du logo KAKO Gestion (fichier généré par scripts/make-brand-assets.mjs, fond transparent). */
export function LogoMark({ className }: { className?: string }) {
  return <Image src="/brand/kako-mark.png" alt="" width={512} height={512} sizes="80px" className={cn("size-10 object-contain", className)} aria-hidden="true" />;
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 [&_img]:transition-transform [&_img]:duration-500 hover:[&_img]:-rotate-[8deg] hover:[&_img]:scale-110", className)}>
      <LogoMark />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="font-display text-[19px] font-extrabold tracking-[0.14em]">KAKO</span>
          <span className="mt-1 text-[8.5px] font-medium uppercase tracking-[0.46em] opacity-70">Gestion</span>
        </span>
      )}
    </span>
  );
}
