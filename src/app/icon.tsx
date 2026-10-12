import { brandIcon } from "@/lib/pwa-icon";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** Icône d'onglet du navigateur. */
export default function Icon() {
  return brandIcon(64);
}
