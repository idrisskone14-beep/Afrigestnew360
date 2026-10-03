import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0F172A" />
      <path d="M8 21.5 14 9.5l3.2 6.2 2.3-4.2 4.5 10" fill="none" stroke="#2563EB" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="9" r="2.4" fill="#00B894" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}>
      <LogoMark />
      {!compact && (
        <span className="text-[17px] leading-none">
          AfriGest <span className="text-brand">360</span>
        </span>
      )}
    </span>
  );
}
