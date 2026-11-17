import type { MetadataRoute } from "next";

/** Manifeste de l'application installable (PWA) : plein écran, raccourcis vers les gestes les plus fréquents. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app/dashboard",
    name: "Global Gest",
    short_name: "Global Gest",
    description: "Gestion d'entreprise : ventes, stock, finance, RH, chantiers et flotte.",
    start_url: "/app/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#000d20",
    theme_color: "#000d20",
    lang: "fr",
    categories: ["business", "productivity", "finance"],
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Nouveau devis", url: "/app/sales/devis/nouveau", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
      { name: "Nouvelle facture", url: "/app/sales/factures/nouveau", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
      { name: "Photographier un justificatif", url: "/app/capture", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
