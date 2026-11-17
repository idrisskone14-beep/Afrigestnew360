import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { RouteProgress } from "@/components/app/route-progress";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeScript } from "@/components/theme-script";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

// adresse publique du site (APP_URL) : sert à rendre absolues les adresses d'images d'aperçu au partage
const siteUrl = (() => {
  try { return new URL(process.env.APP_URL ?? ""); } catch { return new URL("http://localhost:3000"); }
})();
const TITLE = "Global Gest — Du devis à la comptabilité, sans ressaisir une seule ligne";
const DESCRIPTION = "Devis, factures, paiements, stock, comptabilité SYSCOHADA et RH dans un seul outil, en FCFA, sur ordinateur comme sur téléphone.";
const SHARE_IMAGE = { url: "/brand/og-global-gest.jpg", width: 1200, height: 630, alt: "Global Gest" };

export const metadata: Metadata = {
  metadataBase: siteUrl,
  applicationName: "Global Gest",
  title: { default: TITLE, template: "%s · Global Gest" },
  description: DESCRIPTION,
  // aperçu quand le lien est partagé (WhatsApp, Facebook, LinkedIn, X…)
  openGraph: { type: "website", siteName: "Global Gest", locale: "fr_FR", title: TITLE, description: DESCRIPTION, images: [SHARE_IMAGE] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [SHARE_IMAGE.url] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000d20" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning className={inter.variable}>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh font-sans">
        <ThemeProvider>
          <RouteProgress />
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          <Toaster richColors closeButton position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
