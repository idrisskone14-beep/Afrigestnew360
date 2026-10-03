import Link from "next/link";
import { Fragment } from "react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";

export function PageHeader({ title, description, actions, breadcrumbs }: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
}) {
  return (
    <div className="mb-8 space-y-3">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbs.map((b, i) => (
              <Fragment key={`${b.label}-${i}`}>
                <BreadcrumbItem>
                  {b.href && i < breadcrumbs.length - 1 ? (
                    <BreadcrumbLink asChild><Link href={b.href}>{b.label}</Link></BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{b.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {i < breadcrumbs.length - 1 && <BreadcrumbSeparator />}
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="-mb-1.5 overflow-hidden pb-1.5"><h1 className="animate-[title-up_0.8s_cubic-bezier(0.22,1,0.36,1)_backwards] font-display text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1></div>
          {description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: {
  icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-card/60 px-6 py-14 text-center">
      {icon && <div className="mb-3 grid size-14 animate-float place-items-center rounded-full border-2 border-brand-2 bg-accent text-brand">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
