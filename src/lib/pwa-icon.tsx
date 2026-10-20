import { ImageResponse } from "next/og";
import { BRAND_MARK_DATA_URI } from "@/lib/brand-mark-data";

/**
 * Icône de l'application (favicon, écran d'accueil, PWA) : le « K » de KAKO Gestion sur fond blanc.
 * `maskable` : fond plein et motif réduit, pour que les systèmes qui découpent l'icône (cercle, goutte) ne rognent rien.
 */
export function brandIcon(size: number, { maskable = false }: { maskable?: boolean } = {}) {
  const inner = Math.round(maskable ? size * 0.62 : size * 0.84);
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#FFFFFF", borderRadius: maskable ? 0 : size * 0.22 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- rendu hors navigateur (ImageResponse) */}
        <img src={BRAND_MARK_DATA_URI} width={inner} height={inner} alt="" />
      </div>
    ),
    { width: size, height: size },
  );
}
