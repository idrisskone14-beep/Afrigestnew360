import { cn } from "@/lib/utils";

/** Marque : carré vert forêt, ligne de croissance ivoire, pastille ocre — un « A » stylisé qui monte. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#0F3D2E" />
      <path d="M6 24 16 7l10 17" fill="none" stroke="#F5EEDF" strokeWidth="2.6" strokeLinecap="square" strokeLinejoin="miter" />
      <path d="M10.5 18h11" fill="none" stroke="#C4572B" strokeWidth="2.6" strokeLinecap="square" />
      <circle cx="16" cy="7" r="2.6" fill="#E3A72F" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 tracking-tight", className)}>
      <LogoMark />
      {!compact && (
        <span className="font-display text-[19px] font-semibold leading-none">
          AfriGest <span className="italic text-brand">360</span>
        </span>
      )}
    </span>
  );
}
