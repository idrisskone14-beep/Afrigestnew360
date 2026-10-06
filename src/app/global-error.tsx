"use client";

/** Dernier filet : erreur dans le layout racine lui-même. Aucun détail technique n'est affiché, seulement la référence. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", minHeight: "100vh", placeItems: "center", margin: 0, background: "#fff", color: "#1b2a21" }}>
        <div style={{ textAlign: "center", padding: 24, maxWidth: 480 }}>
          <h1 style={{ fontSize: 28, marginBottom: 8 }}>Une erreur est survenue</h1>
          <p style={{ color: "#6c614d" }}>Nous n&apos;avons pas pu afficher cette page.{error.digest ? ` Référence : ${error.digest}.` : ""}</p>
          <button onClick={reset} style={{ marginTop: 16, padding: "10px 20px", background: "#0f3d2e", color: "#fff", border: 0, borderRadius: 6, fontWeight: 600, cursor: "pointer" }}>
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
