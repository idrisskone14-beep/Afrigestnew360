import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { getCurrentSession } from "@/core/auth/session";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">Aller au contenu</a>
      <SiteHeader signedIn={Boolean(session)} />
      <main id="contenu" className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
