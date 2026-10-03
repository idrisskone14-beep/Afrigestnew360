import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold text-brand">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page introuvable</h1>
      <p className="mt-2 text-sm text-muted-foreground">La page demandée n'existe pas ou a été déplacée.</p>
      <Button asChild className="mt-6"><Link href="/">Retour à l'accueil</Link></Button>
    </div>
  );
}
