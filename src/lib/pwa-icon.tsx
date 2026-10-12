import { ImageResponse } from "next/og";

/**
 * Icône de l'application (favicon, écran d'accueil, PWA) : la marque AfriGest — carré bleu marine, « A » blanc, barre et pastille orange.
 * `maskable` : fond plein et motif réduit, pour que les systèmes qui découpent l'icône (cercle, goutte) ne rognent rien.
 */
export function brandIcon(size: number, { maskable = false }: { maskable?: boolean } = {}) {
  const inner = maskable ? size * 0.62 : size * 0.78;
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#0B2A5B", borderRadius: maskable ? 0 : size * 0.22 }}>
        <svg width={inner} height={inner} viewBox="0 0 32 32">
          <path d="M6 24 16 7l10 17" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="square" strokeLinejoin="miter" />
          <path d="M10.5 18h11" fill="none" stroke="#F97316" strokeWidth="2.6" strokeLinecap="square" />
          <circle cx="16" cy="7" r="2.6" fill="#FDBA74" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
