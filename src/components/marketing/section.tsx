import { cn } from "@/lib/utils";

export function Section({ id, eyebrow, title, description, children, className, tone }: {
  id?: string; eyebrow?: string; title?: string; description?: string; children?: React.ReactNode; className?: string; tone?: "muted";
}) {
  return (
    <section id={id} className={cn("py-16 sm:py-24", tone === "muted" && "bg-gradient-to-b from-muted/50 to-accent/30", className)}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {(title || eyebrow) && (
          <div className="mx-auto mb-12 max-w-2xl text-center">
            {eyebrow && <p className="inline-block rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand">{eyebrow}</p>}
            {title && <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>}
            {description && <p className="mt-4 text-base text-muted-foreground sm:text-lg">{description}</p>}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

export function PageIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="border-b bg-gradient-to-b from-accent/50 to-transparent">
      <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-20">
        <p className="inline-block rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand">{eyebrow}</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl"><span className="gradient-brand-text">{title}</span></h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
