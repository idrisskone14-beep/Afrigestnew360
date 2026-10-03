import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Forbidden() {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <ShieldAlert className="size-12 text-warning" />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Accès refusé</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Vous n'avez pas accès à cette page : le module n'est pas activé pour votre entreprise ou votre rôle ne comprend pas cette permission.
      </p>
      <Button asChild className="mt-6"><Link href="/app/dashboard">Retour au tableau de bord</Link></Button>
    </div>
  );
}
