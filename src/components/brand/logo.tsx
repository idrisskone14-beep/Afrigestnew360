import { cn } from "@/lib/utils";

/** Marque : carré bleu marine, ligne de croissance blanche, barre et pastille orange — un « A » stylisé qui monte. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#0B2A5B" />
      <path d="M6 24 16 7l10 17" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="square" strokeLinejoin="miter" />
      <path d="M10.5 18h11" fill="none" stroke="#F97316" strokeWidth="2.6" strokeLinecap="square" />
      <circle cx="16" cy="7" r="2.6" fill="#FDBA74" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 tracking-tight [&_svg]:transition-transform [&_svg]:duration-500 hover:[&_svg]:-rotate-[10deg] hover:[&_svg]:scale-110", className)}>
      <LogoMark />
      {!compact && (
        <span className="font-display text-[19px] font-semibold leading-none">
          AfriGest <span className="italic text-brand">360</span>
        </span>
      )}
    </span>
  );
}
