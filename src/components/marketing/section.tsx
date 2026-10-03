import { cn } from "@/lib/utils";

export function Section({ id, eyebrow, title, description, children, className, tone }: {
  id?: string; eyebrow?: string; title?: string; description?: string; children?: React.ReactNode; className?: string; tone?: "muted";
}) {
  return (
    <section id={id} className={cn("py-16 sm:py-24", tone === "muted" && "border-y border-border bg-secondary/60", className)}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {(title || eyebrow) && (
          <div className="mx-auto mb-12 max-w-2xl text-center">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-5xl">{title}</h2>}
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
    <div className="border-b border-border">
      <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-20">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight sm:text-6xl">{title}</h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
