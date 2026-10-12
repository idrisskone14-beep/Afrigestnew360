import { brandIcon } from "@/lib/pwa-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Icône de l'écran d'accueil iPhone / iPad. */
export default function AppleIcon() {
  return brandIcon(180, { maskable: true });
}
