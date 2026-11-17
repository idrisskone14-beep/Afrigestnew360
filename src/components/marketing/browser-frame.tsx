import Image from "next/image";
import { cn } from "@/lib/utils";

/** Fenêtre de navigateur autour d'une capture réelle du produit (le contenu est fourni en enfant). */
export function BrowserFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-card shadow-offset-lg", className)}>
      <div className="flex items-center gap-1.5 border-b bg-secondary px-3.5 py-2.5" aria-hidden="true">
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="mx-auto rounded-md bg-background px-3 py-0.5 text-[11px] text-muted-foreground">global-gest.com</span>
        <span className="w-9" />
      </div>
      {children}
    </div>
  );
}

/** Capture d'écran d'un ordinateur dans sa fenêtre. `priority` pour l'image visible au chargement de la page. */
export function DesktopShot({ src, alt, priority = false, sizes, className }: { src: string; alt: string; priority?: boolean; sizes?: string; className?: string }) {
  return (
    <BrowserFrame className={className}>
      <Image src={src} alt={alt} width={1600} height={1000} priority={priority} sizes={sizes ?? "(min-width: 1024px) 760px, 100vw"} className="block h-auto w-full" />
    </BrowserFrame>
  );
}

/** Capture d'écran d'un téléphone dans son boîtier. */
export function PhoneShot({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <div className={cn("mx-auto w-[250px] rounded-[2.4rem] bg-foreground/90 p-[7px] shadow-offset-lg sm:w-[270px]", className)}>
      <div className="overflow-hidden rounded-[1.95rem] bg-background">
        <Image src={src} alt={alt} width={700} height={1515} sizes="270px" className="block h-auto w-full" />
      </div>
    </div>
  );
}
