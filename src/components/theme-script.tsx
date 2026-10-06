import { headers } from "next/headers";

const SCRIPT = `(function(){try{var t=localStorage.getItem('afg-theme');var d=t==='dark'||((t!=='light')&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light'}catch(e){}})()`;

/** Composant serveur : applique le thème avant le premier rendu (évite le flash blanc). Porte le nonce de la CSP. */
export async function ThemeScript() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
